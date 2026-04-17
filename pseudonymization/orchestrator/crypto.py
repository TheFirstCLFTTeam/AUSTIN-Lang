"""
Symmetric envelope for span original_text. Fernet (AES-128-CBC + HMAC-SHA256)
is sufficient for at-rest protection within the enclave; KMS rotation is an
open item (Appendix B of the implementation plan).

The key comes from PSEUDONYM_FERNET_KEY. In dev a generated key is logged
once on startup so a fresh checkout works without secrets ceremony.
"""

import os
import sys

from cryptography.fernet import Fernet

_ENV_VAR = "PSEUDONYM_FERNET_KEY"


def _load_key() -> bytes:
    raw = os.getenv(_ENV_VAR)
    if raw:
        return raw.encode("utf-8")
    generated = Fernet.generate_key()
    print(
        f"[crypto] {_ENV_VAR} not set — generated dev key: {generated.decode()}",
        file=sys.stderr,
    )
    return generated


_FERNET = Fernet(_load_key())


def encrypt(plaintext: str) -> bytes:
    return _FERNET.encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes) -> str:
    return _FERNET.decrypt(ciphertext).decode("utf-8")
