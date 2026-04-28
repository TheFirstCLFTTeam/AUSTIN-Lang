-- adapter_name IS NULL ⇒ this row is a base-model baseline (no LoRA).
-- The (base_model, adapter_name) pair matches PEFT's load semantics in
-- transcription-service-2 — adapter_name = NULL maps to disable_adapter().
CREATE TABLE IF NOT EXISTS model_evaluation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    base_model      TEXT NOT NULL,
    adapter_name    TEXT,
    adapter_version TEXT,
    dataset_name    TEXT NOT NULL,
    evaluated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sample_count    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'completed',
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_evaluation_lookup
    ON model_evaluation(base_model, dataset_name, adapter_name, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS evaluation_metric (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id   INTEGER NOT NULL REFERENCES model_evaluation(id) ON DELETE CASCADE,
    strategy_name   TEXT NOT NULL,
    value           REAL NOT NULL,
    breakdown_json  TEXT NOT NULL DEFAULT '{}',
    sample_count    INTEGER NOT NULL DEFAULT 0,
    computed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_evaluation_metric_evaluation
    ON evaluation_metric(evaluation_id);

CREATE INDEX IF NOT EXISTS idx_evaluation_metric_strategy
    ON evaluation_metric(strategy_name);
