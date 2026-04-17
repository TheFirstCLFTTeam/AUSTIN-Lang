"""Seed database(FE)/platform.db from seed/fixtures/*.json.

Run from repo root or from database(FE)/:
    python database(FE)/seed/seed_platform_db.py

Drops + recreates every table in platform.db, then inserts:
  - Permissions, resources, groups, group policies, group membership
  - Datasets (source + custom) + tags/languages
  - Audio files + raw transcripts (from sampled + root-level files)
  - Processing jobs + recordings
  - Training jobs + loss history
  - Metrics + series + selected metrics + critical terms + accuracy logs
  - Leaderboard submissions + worst examples
  - Audit actions + events

Cross-database FKs (to users.db) are stored as plain TEXT — SQLite does not
support cross-database FKs. Application-layer integrity is expected.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_DIR = HERE.parent
DB_PATH = DB_DIR / "platform.db"
SCHEMA_PATH = DB_DIR / "schema_platform.sql"
FIXTURES = HERE / "fixtures"


def load_fixture(name: str):
    path = FIXTURES / f"{name}.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def rebuild_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))


# ── Catalogues & groups ─────────────────────────────────────────────────────

def seed_catalogues(conn: sqlite3.Connection) -> None:
    permissions = load_fixture("permissions_catalogue")
    resources = load_fixture("resources_catalogue")
    conn.executemany(
        "INSERT INTO permission_catalogue (key, label, description) VALUES (?, ?, ?)",
        [(p["key"], p["label"], p.get("description")) for p in permissions],
    )
    conn.executemany(
        "INSERT INTO resource_catalogue (key, label) VALUES (?, ?)",
        [(r["key"], r["label"]) for r in resources],
    )


def seed_groups(conn: sqlite3.Connection) -> None:
    groups = load_fixture("groups")
    assignments = load_fixture("group_assignments")
    policies = load_fixture("group_policies")

    conn.executemany(
        """INSERT INTO user_group
           (id, name, description, category, repository_size)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (g["id"], g["name"], g.get("description"), g["category"], g.get("repositorySize"))
            for g in groups
        ],
    )

    membership_rows = []
    for user_id, group_ids in assignments.items():
        for gid in group_ids:
            membership_rows.append((user_id, gid))
    conn.executemany(
        "INSERT INTO user_group_membership (user_id, group_id) VALUES (?, ?)",
        membership_rows,
    )

    perm_rows, res_rows = [], []
    for group_id, policy in policies.items():
        for perm_key in policy.get("permissions", []):
            perm_rows.append((group_id, perm_key))
        for res_key in policy.get("resources", []):
            res_rows.append((group_id, res_key))
    conn.executemany(
        "INSERT INTO group_permission (group_id, permission_key) VALUES (?, ?)",
        perm_rows,
    )
    conn.executemany(
        "INSERT INTO group_resource (group_id, resource_key) VALUES (?, ?)",
        res_rows,
    )


# ── Datasets ────────────────────────────────────────────────────────────────

def seed_datasets(conn: sqlite3.Connection) -> None:
    folders = load_fixture("sampled_folders")
    source_meta = load_fixture("source_dataset_meta")
    custom = load_fixture("custom_datasets")

    dataset_rows = []
    language_rows = []
    tag_rows = []

    for f in folders:
        meta = source_meta.get(f["id"], {})
        dataset_rows.append((
            f["id"],
            "source",
            f["name"],
            f.get("source"),
            meta.get("description"),
            None,
            meta.get("status"),
            meta.get("purpose"),
            meta.get("origin"),
            None,
            f.get("fileCount", 0),
        ))
        for lang in meta.get("languages", []):
            language_rows.append((f["id"], lang))
        for tag in meta.get("tags", []):
            tag_rows.append((f["id"], tag))

    for c in custom:
        dataset_rows.append((
            c["id"],
            "custom",
            c["name"],
            None,
            c.get("description"),
            None,
            None,
            None,
            None,
            c.get("createdBy"),
            c.get("fileCount", 0),
        ))
        for tag in c.get("tags", []):
            tag_rows.append((c["id"], tag))

    conn.executemany(
        """INSERT INTO dataset (
             id, kind, name, source, description, category, status, purpose,
             origin, created_by, file_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        dataset_rows,
    )
    conn.executemany(
        "INSERT INTO dataset_language (dataset_id, language) VALUES (?, ?)",
        language_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO dataset_tag (dataset_id, tag) VALUES (?, ?)",
        tag_rows,
    )


# ── Audio files + raw transcripts ───────────────────────────────────────────

def _parse_duration(label: str | None) -> float | None:
    if not label or ":" not in label:
        return None
    try:
        m, s = label.split(":")
        return int(m) * 60 + int(s)
    except ValueError:
        return None


def seed_audio_and_transcripts(conn: sqlite3.Connection) -> None:
    sampled = load_fixture("sampled_files")
    root = load_fixture("root_level_files")

    all_files = [(f, f.get("dataset")) for f in sampled] + [(f, None) for f in root]

    for f, dataset_id in all_files:
        duration_label = f.get("duration")
        cur = conn.execute(
            """INSERT INTO audio_file (
                 file_name, uploaded_at, external_id, dataset_id, display_name,
                 owner_id, detected_language, duration_sec, duration_label,
                 audio_rel_path, status, stage
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                f.get("name") or f["id"],
                f.get("uploaded_at"),
                f["id"],
                dataset_id,
                f.get("name"),
                f.get("ownerId"),
                f.get("detectedLanguage"),
                _parse_duration(duration_label),
                duration_label,
                f.get("audioUrl"),
                f.get("status"),
                None,
            ),
        )
        audio_id = cur.lastrowid

        raw = f.get("rawTranscript")
        if not raw:
            continue

        cur = conn.execute(
            "INSERT INTO raw_transcript (audio_file_id, rating) VALUES (?, ?)",
            (audio_id, raw.get("rating")),
        )
        raw_id = cur.lastrowid

        seg_rows = [
            (raw_id, seg["start"], seg["end"], seg["text"])
            for seg in raw.get("transcript_segments", [])
        ]
        if seg_rows:
            conn.executemany(
                """INSERT INTO raw_transcript_segment
                   (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)""",
                seg_rows,
            )


# ── Processing queue ────────────────────────────────────────────────────────

def seed_processing(conn: sqlite3.Connection) -> None:
    jobs = load_fixture("processing_jobs")

    job_rows, rec_rows, cause_rows = [], [], []

    for j in jobs:
        job_rows.append((
            j["id"], j["name"], j.get("submittedBy"), j.get("source"),
            j.get("sourcePath"), j.get("language"), j["status"],
            j.get("progress", 0), j.get("stage"),
            j.get("submittedAt"), j.get("estimatedCompletion"),
        ))
        for r in j.get("recordings", []):
            err = r.get("error") or {}
            rec_rows.append((
                r["id"], j["id"], r["fileName"], r.get("duration"),
                r.get("sizeMb"), r.get("progress", 0), r["status"], r.get("stage"),
                err.get("code"), err.get("message"), err.get("timestamp"),
            ))
            for cause in err.get("commonCauses", []):
                cause_rows.append((r["id"], cause))

    conn.executemany(
        """INSERT INTO processing_job (
             id, name, submitted_by, source, source_path, language,
             status, progress, stage, submitted_at, estimated_completion
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        job_rows,
    )
    conn.executemany(
        """INSERT INTO recording (
             id, job_id, file_name, duration, size_mb, progress, status,
             stage, error_code, error_message, error_timestamp
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rec_rows,
    )
    conn.executemany(
        "INSERT INTO recording_error_cause (recording_id, cause) VALUES (?, ?)",
        cause_rows,
    )


# ── Training ────────────────────────────────────────────────────────────────

def seed_training(conn: sqlite3.Connection) -> None:
    jobs = load_fixture("training_jobs")

    job_rows, loss_rows = [], []
    for j in jobs:
        metrics = j.get("metrics") or {}
        infra = j.get("infra") or {}
        job_rows.append((
            j["id"], j["status"], j.get("progress"), j.get("gpu"),
            j.get("startTime"), j.get("startedAtIso"),
            j.get("submittedBy"), j.get("submittedAtIso"),
            j.get("description"), j.get("baseModel"),
            1 if j.get("useLora") else 0,
            j.get("rank"), j.get("loraAlpha"),
            j.get("lr"), j.get("epochs"), j.get("currentEpoch"),
            j.get("batchSize"), j.get("datasetRef"), j.get("datasetName"),
            j.get("currentStep"), j.get("totalSteps"),
            metrics.get("trainLoss"), metrics.get("valLoss"),
            metrics.get("tokensPerSec"), metrics.get("gradNorm"),
            j.get("elapsedMin"), j.get("etaMin"),
            infra.get("cluster"), infra.get("gpuType"), infra.get("region"),
        ))
        for pt in j.get("lossHistory", []):
            loss_rows.append((j["id"], pt["step"], pt["loss"]))

    conn.executemany(
        """INSERT INTO training_job (
             id, status, progress, gpu_pct, start_time, started_at,
             submitted_by, submitted_at, description, base_model, use_lora,
             lora_rank, lora_alpha, learning_rate, epochs, current_epoch,
             batch_size, dataset_ref, dataset_name, current_step, total_steps,
             train_loss, val_loss, tokens_per_sec, grad_norm,
             elapsed_min, eta_min, cluster, gpu_type, region
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        job_rows,
    )
    conn.executemany(
        "INSERT INTO training_loss_history (training_job_id, step, loss) VALUES (?, ?, ?)",
        loss_rows,
    )


# ── Metrics ─────────────────────────────────────────────────────────────────

def seed_metrics(conn: sqlite3.Connection) -> None:
    metadata = load_fixture("metrics_metadata")
    display = {row["id"]: row for row in load_fixture("metrics_display")}
    selected_ids = load_fixture("selected_metric_ids")
    critical_terms = load_fixture("critical_term_failures")
    accuracy = load_fixture("accuracy_logs")

    metric_rows, series_rows = [], []
    for m in metadata:
        metric_rows.append((
            m["id"], m["name"], m.get("shortDescription"), m.get("description"),
            m.get("pythonScript"), m.get("target"), m.get("dateRevised"),
            1 if m.get("custom") else 0, m.get("filename"),
        ))
        d = display.get(m["id"])
        if d:
            s = d.get("series") or {}
            series_rows.append((
                m["id"],
                json.dumps(s.get("baseModel") or []),
                json.dumps(s.get("fineTuned") or []),
                s.get("yMin"), s.get("yMax"), s.get("unit"),
                s.get("currentValue"), s.get("difference"),
                d.get("value"), d.get("sublabel"),
                1 if d.get("accent") else 0,
            ))

    conn.executemany(
        """INSERT INTO metric (
             id, name, short_description, description, python_script,
             target, date_revised, is_custom, filename
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        metric_rows,
    )
    conn.executemany(
        """INSERT INTO metric_series (
             metric_id, base_model_json, fine_tuned_json, y_min, y_max, unit,
             current_value, difference, value_label, sublabel, accent
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        series_rows,
    )
    conn.executemany(
        "INSERT INTO selected_metric (metric_id, sort_order) VALUES (?, ?)",
        [(mid, i) for i, mid in enumerate(selected_ids)],
    )
    conn.executemany(
        "INSERT INTO critical_term_failure (term, edits) VALUES (?, ?)",
        [(c["term"], c["edits"]) for c in critical_terms],
    )
    conn.executemany(
        """INSERT INTO accuracy_log (id, title, duration, editor, accuracy, change)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (a["id"], a["title"], a.get("dur"), a.get("editor"), float(a["accuracy"]), a.get("change"))
            for a in accuracy
        ],
    )


# ── Leaderboard ─────────────────────────────────────────────────────────────

def seed_leaderboard(conn: sqlite3.Connection) -> None:
    source = load_fixture("leaderboard_source")
    custom = load_fixture("leaderboard_custom")

    sub_rows, worst_rows = [], []
    for row in source + custom:
        repro = row.get("reproducibility") or {}
        sub_rows.append((
            row["id"], row["datasetId"], row.get("engineerId"),
            row.get("engineerName"), row["modelName"], row.get("baseFamily"),
            row.get("wer"), row.get("cer"), row.get("rtf"),
            row.get("submissionCount", 1), row.get("submittedAt"),
            1 if repro.get("config") else 0,
            1 if repro.get("checkpoint") else 0,
            1 if repro.get("notebook") else 0,
        ))
        for ex in row.get("worstExamples") or []:
            worst_rows.append((
                ex["id"], row["id"],
                ex.get("refText"), ex.get("predText"), ex.get("utteranceWer"),
            ))

    conn.executemany(
        """INSERT INTO leaderboard_submission (
             id, dataset_id, engineer_id, engineer_name, model_name,
             base_family, wer, cer, rtf, submission_count, submitted_at,
             config_stored, checkpoint_stored, notebook_stored
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        sub_rows,
    )
    conn.executemany(
        """INSERT INTO leaderboard_worst_example (
             id, submission_id, ref_text, pred_text, utterance_wer
           ) VALUES (?, ?, ?, ?, ?)""",
        worst_rows,
    )


# ── Audit ───────────────────────────────────────────────────────────────────

def seed_audit(conn: sqlite3.Connection) -> None:
    actions = load_fixture("audit_actions")
    events = load_fixture("audit_events")

    action_rows = [
        (key, v["label"], v.get("verb"), v.get("category"), v.get("color"))
        for key, v in actions.items()
    ]
    conn.executemany(
        """INSERT INTO audit_action (key, label, verb, category, color)
           VALUES (?, ?, ?, ?, ?)""",
        action_rows,
    )

    event_rows = []
    for ev in events:
        event_rows.append((
            ev["id"], ev.get("fileId"), ev.get("actorId"), ev.get("actorName"),
            ev["action"], ev["timestamp"],
            json.dumps(ev.get("details") or {}),
        ))
    conn.executemany(
        """INSERT INTO audit_event (
             id, file_id, actor_id, actor_name, action_key, timestamp, details_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        event_rows,
    )


# ── Orchestrator ────────────────────────────────────────────────────────────

TABLES_FOR_COUNT = [
    "permission_catalogue", "resource_catalogue", "user_group",
    "user_group_membership", "group_permission", "group_resource",
    "dataset", "dataset_language", "dataset_tag",
    "audio_file", "raw_transcript", "raw_transcript_segment",
    "transcript_edit",
    "processing_job", "recording", "recording_error_cause",
    "training_job", "training_loss_history",
    "metric", "metric_series", "selected_metric",
    "critical_term_failure", "accuracy_log",
    "leaderboard_submission", "leaderboard_worst_example",
    "audit_action", "audit_event",
]


def main() -> None:
    if not SCHEMA_PATH.exists():
        raise SystemExit(f"schema missing: {SCHEMA_PATH}")
    if not FIXTURES.exists():
        raise SystemExit(f"fixtures missing: {FIXTURES} -- run `npm run dump` first")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        rebuild_schema(conn)
        with conn:
            seed_catalogues(conn)
            seed_groups(conn)
            seed_datasets(conn)
            seed_audio_and_transcripts(conn)
            seed_processing(conn)
            seed_training(conn)
            seed_metrics(conn)
            seed_leaderboard(conn)
            seed_audit(conn)

        print(f"platform.db seeded -> {DB_PATH}")
        for t in TABLES_FOR_COUNT:
            count = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            print(f"  {t.ljust(32)} {count:>6}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
