"""Settings, env-driven via pydantic-settings.

Sibling pattern to backend/meeting_webhooks/app/config.py and
backend/training_orchestrator/main.py — kept minimal because this
service has very few moving parts.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8009
    db_path: str = "/app/data/financial_terms.db"

    # Path to the seed CSV inside the container. Slice 2 reads from this
    # via app/seed.py to populate an empty DB on first boot. For slice 1
    # this setting is recorded but unused.
    seed_csv_path: str = "/app/financialTerms.csv"
    # Seed on first boot when the DB is empty (slice 2 wires this in).
    seed_on_boot: bool = True


settings = Settings()
