# database(FE)

Two SQLite databases and a seed pipeline that rebuilds them from the frontend
mock modules.

## Files

| File | Purpose |
|---|---|
| `users.db` | Identity: `user`, `user_profile`, `user_session`, `user_access_right`, `user_permission_group`, `user_permission_grant`, `client`, `client_language` |
| `platform.db` | Everything else: groups/policies, datasets, `audio_file`, transcripts, processing queue, training, metrics, leaderboard, audit |
| `schema_users.sql` | DDL for `users.db` |
| `schema_platform.sql` | DDL for `platform.db` |
| `main.py` | FastAPI service over the transcript tables (audio_file / raw_transcript / edited_transcript). **Note:** change the `DatabaseClient(db_path='poc.db', ...)` line to point at `platform.db` |
| `seed/` | Seed pipeline (Node dump -> Python insert) |
| `requirements.txt` | Python deps: fastapi, uvicorn, pydantic, bcrypt |

## Regenerating the databases

From the repo root:

```bash
# 1. Dump the frontend mock modules into seed/fixtures/*.json
cd database\(FE\)/seed
npm run dump

# 2. Rebuild users.db + platform.db (Windows: use `python -X utf8` if your console
#    default codepage is cp1252, otherwise plain `python` is fine)
cd ..
python -X utf8 seed/seed_users_db.py
python -X utf8 seed/seed_platform_db.py
```

Each seed script drops and recreates every table before inserting, so repeated
runs produce a stable snapshot.

## Persona credentials

All four personas share `password123` in the mock. The seeder bcrypt-hashes it
per user (12 rounds) before insert. Plaintext never lands in the DB.

| Email | Role |
|---|---|
| `user@example.com` | generic |
| `engineer@example.com` | engineer |
| `admin@example.com` | admin |
| `reviewer@example.com` | reviewer |

## Cross-database references

SQLite does not support cross-database foreign keys. `platform.db` tables
reference `users.db` identifiers (`user.id`, `client.id`) as plain `TEXT`
columns with no FK constraint. The application layer is responsible for
consistency.

Affected columns in `platform.db`:

- `user_group_membership.user_id`
- `audio_file.owner_id`
- `leaderboard_submission.engineer_id`
- `transcript_edit.editor_id`
- `audit_event.actor_id`
- `training_job.submitted_by`
- `dataset.created_by`

## Seed pipeline internals

### `seed/dump_mocks.mjs`

Node ES-module script that dynamically imports every mock module in
dependency order and writes one JSON fixture per data slice to
`seed/fixtures/`. The frontend modules use two syntaxes that bare Node
rejects:

- Extension-less relative imports (`./mock_data-users` instead of `.js`)
- Legacy JSON imports without `with { type: "json" }`

A custom resolve-hook in `seed/json-loader.mjs` patches both transparently, so
the frontend source stays untouched.

### `seed/seed_users_db.py` + `seed/seed_platform_db.py`

Each script:

1. Executes the matching schema file (drops existing tables first).
2. Loads fixtures from `seed/fixtures/*.json`.
3. Inserts inside a single transaction, hashing passwords via
   `seed/hashing.py` (bcrypt).
4. Prints a per-table row count for verification.
