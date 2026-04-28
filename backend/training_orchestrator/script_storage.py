"""Persisted training-script storage for `POST /jobs/{id}/script`.

Mirrors the F6 audio-upload harness on the FE side
(frontend/src/app/api/upload/route.js): size cap → declared-MIME check →
extension check → magic-byte / textual sniff → SHA256 → write to disk.
Caller (main.py) drives the HTTP envelope; this module owns validation
and on-disk layout so it stays testable without FastAPI.

On-disk layout — one directory per job, fixed filename `script.py` (or
`.sh` if a shell entrypoint becomes a thing later). Keeping the on-disk
filename canonical makes the worker invocation predictable; the original
client-supplied filename is recorded on the job row for display only.

    {script_dir}/{job_id}/script.{ext}

`{script_dir}` defaults to `/app/data/scripts` inside the orchestrator
container; tests pass `tmp_path` directly via the `script_dir` arg.

Re-uploading replaces the prior file: per the §3.3 design the script is
only mutable while the job is still queued (the storage layer enforces
that — see `JobStore.attach_script`), so an in-place overwrite is fine.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# 256 KB. Real-world `train.py` in this repo is ~6 KB; 256 KB swallows
# any reasonable LoRA + Trainer config wrapper plus comments. Way below
# the F6 audio cap (100 MB) on purpose — Python source has no business
# being big and a fat upload is almost certainly an accident or attack.
DEFAULT_MAX_SCRIPT_BYTES = 256 * 1024


# Mirrors FE upload-route style: a small allow-list, not a free-for-all.
# Python is the canonical training entrypoint (`retraining-pipeline/
# train.py`). `application/octet-stream` is what curl -F sends without
# a hint and what most browsers send for `.py` because the OS doesn't
# register a MIME for it — accept it but the sniff still has to pass.
ALLOWED_MIME = {
    "text/x-python",
    "text/x-python-script",
    "text/plain",
    "application/x-python",
    "application/x-python-code",
    "application/octet-stream",
    "",  # missing Content-Type from a multipart part
}

ALLOWED_EXTENSIONS = {"py"}


# Tokens that, if any one appears in the head of the file, say "this is
# Python source" with high confidence. Deliberately permissive — a script
# without imports or `def` would be unusual but legal. Keep the list short:
# false positives here just let through a weird-but-valid Python file;
# false negatives reject a legitimate train.py.
_PYTHON_HEAD_TOKENS = (
    b"import ",
    b"from ",
    b"def ",
    b"class ",
    b"#!",          # shebang
    b"# ",          # leading comment line
    b"\"\"\"",      # docstring at top of module
    b"'''",
    b"if __name__",
    b"@",           # decorator-only top — rare but legal
    b"print(",
)


@dataclass
class ScriptRejected(Exception):
    """Raised when an upload fails one of the validation gates.

    `status_code` is what the HTTP layer should return (413 for over-cap,
    415 for wrong type, 400 for malformed); the API layer maps this to an
    HTTPException without further interpretation.
    """

    detail: str
    status_code: int = 400

    def __str__(self) -> str:  # pragma: no cover — convenience
        return self.detail


@dataclass
class StoredScript:
    """The result of a successful upload, returned to the API layer."""

    job_id: str
    filename: str
    sha256: str
    size_bytes: int
    on_disk_path: str


def looks_like_python(head: bytes) -> bool:
    """True when the first chunk of a file is plausibly Python source.

    Two-stage smoke test — first reject anything that's clearly not text
    (null bytes / non-UTF-8), then look for any of the high-confidence
    Python tokens in the head. The test is intentionally lenient: an
    empty file fails (size guard catches that elsewhere), a binary file
    fails (null byte check), a non-Python text file fails (token list).
    """
    if not head:
        return False
    # No null bytes — every binary format we care to reject (zip, tar.gz,
    # ELF, PE, .pyc) has 0x00 in the first kilobyte; .py never does.
    if b"\x00" in head:
        return False
    # Must decode as UTF-8 (Python source is required to be UTF-8 since
    # PEP 3120). Allow a leading BOM — some Windows editors add one.
    sample = head.lstrip(b"\xef\xbb\xbf")
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    # Any of the well-known Python head tokens anywhere in the first
    # chunk → accept.
    for token in _PYTHON_HEAD_TOKENS:
        if token in sample:
            return True
    # Fallback: pure-whitespace head is an empty-ish file; accept if the
    # rest of the file passes downstream parse checks (we don't run
    # those — see module docstring on threat model).
    return sample.strip() == b""


def _safe_basename(filename: Optional[str], default: str = "script.py") -> str:
    """Strip directory traversal + null bytes from a client-supplied
    filename. Used only for on-disk storage; the API layer already
    captures the raw filename onto the job row for display."""
    if not filename:
        return default
    name = os.path.basename(filename.replace("\\", "/"))
    name = name.replace("\x00", "")
    return name or default


def get_max_bytes() -> int:
    """Read the size cap from `MAX_SCRIPT_BYTES` env at call time. Honoured
    on every upload so test fixtures can monkeypatch it without bouncing
    a global module-level constant."""
    raw = os.getenv("MAX_SCRIPT_BYTES")
    if not raw:
        return DEFAULT_MAX_SCRIPT_BYTES
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_MAX_SCRIPT_BYTES


def get_script_dir() -> Path:
    """Default per-job script root, overridable via env."""
    return Path(os.getenv("TRAINING_SCRIPT_DIR", "/app/data/scripts"))


def store_script(
    *,
    job_id: str,
    filename: Optional[str],
    declared_mime: Optional[str],
    raw_bytes: bytes,
    script_dir: Optional[Path] = None,
    max_bytes: Optional[int] = None,
) -> StoredScript:
    """Validate, write to disk, return the recorded metadata.

    Raises `ScriptRejected` on any validation failure; the API layer maps
    the exception's `status_code` straight to the HTTP response.
    """
    cap = max_bytes if max_bytes is not None else get_max_bytes()
    if not raw_bytes:
        raise ScriptRejected("script is empty", status_code=400)
    if len(raw_bytes) > cap:
        raise ScriptRejected(
            f"script too large (max {cap} bytes, got {len(raw_bytes)})",
            status_code=413,
        )

    declared = (declared_mime or "").lower().split(";", 1)[0].strip()
    if declared not in ALLOWED_MIME:
        raise ScriptRejected(
            f"unsupported content-type: {declared!r}",
            status_code=415,
        )

    safe_name = _safe_basename(filename)
    ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ScriptRejected(
            f"unsupported file extension: .{ext or '<none>'} (allow: .py)",
            status_code=415,
        )

    head = raw_bytes[:4096]
    if not looks_like_python(head):
        raise ScriptRejected(
            "file does not look like a Python source file",
            status_code=415,
        )

    digest = hashlib.sha256(raw_bytes).hexdigest()

    base = (script_dir or get_script_dir()) / job_id
    base.mkdir(parents=True, exist_ok=True)
    on_disk = base / f"script.{ext}"
    # Write atomically: write to a temp file in the same dir then rename
    # so a crashed upload doesn't leave a half-written script on disk
    # for the worker to pick up.
    tmp = on_disk.with_suffix(on_disk.suffix + ".tmp")
    tmp.write_bytes(raw_bytes)
    os.replace(tmp, on_disk)

    return StoredScript(
        job_id=job_id,
        filename=safe_name,
        sha256=digest,
        size_bytes=len(raw_bytes),
        on_disk_path=str(on_disk),
    )
