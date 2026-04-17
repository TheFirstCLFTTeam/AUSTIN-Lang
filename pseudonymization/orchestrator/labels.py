"""
Versioned entity taxonomy. Sent to gliner on every request so the label set
can evolve without redeploying the inference service. label_set_version is
recorded on each run for re-runnability.

Mirrors PSEUDONYMISATION_LABEL_SET in
frontend/src/services/mock_data-pseudonymisation.js so the contract holds
end-to-end.
"""

from typing import Dict, List, TypedDict


class LabelSpec(TypedDict):
    id: str
    label: str
    threshold: float
    placeholder_prefix: str


LABEL_SET_VERSION = "banking-v3"
MODEL_VERSION = "gliner_medium-v2.1"

# Order matters for overlap resolution tie-breaks: rarer/more specific entities
# first so a tied span resolves to the more specific label.
LABELS: List[LabelSpec] = [
    {"id": "person_name",                "label": "person name",                          "threshold": 0.6,  "placeholder_prefix": "NAME"},
    {"id": "phone_number",               "label": "phone number",                         "threshold": 0.5,  "placeholder_prefix": "PHONE"},
    {"id": "email_address",              "label": "email address",                        "threshold": 0.5,  "placeholder_prefix": "EMAIL"},
    {"id": "bank_account_id",            "label": "bank account id",                      "threshold": 0.45, "placeholder_prefix": "BANK_ID"},
    {"id": "customer_reference_id",      "label": "customer reference id",                "threshold": 0.45, "placeholder_prefix": "CRID"},
    {"id": "trading_account_id",         "label": "trading account id",                   "threshold": 0.45, "placeholder_prefix": "TRADE_ID"},
    {"id": "address",                    "label": "address",                              "threshold": 0.55, "placeholder_prefix": "ADDR"},
    {"id": "date_of_birth",              "label": "date of birth",                        "threshold": 0.6,  "placeholder_prefix": "DOB"},
    {"id": "national_id",                "label": "national id",                          "threshold": 0.5,  "placeholder_prefix": "NATIONAL_ID"},
    {"id": "passport_number",            "label": "passport number",                      "threshold": 0.5,  "placeholder_prefix": "PASSPORT"},
    {"id": "monetary_amount_individual", "label": "monetary amount tied to an individual","threshold": 0.55, "placeholder_prefix": "AMOUNT"},
    {"id": "internal_project_codename",  "label": "internal project codename",            "threshold": 0.65, "placeholder_prefix": "PROJECT"},
]

LABEL_NAMES: List[str] = [spec["label"] for spec in LABELS]
THRESHOLDS: Dict[str, float] = {spec["label"]: spec["threshold"] for spec in LABELS}

# Inverse: friendly label string → canonical id used in spans/placeholders.
LABEL_TO_ID: Dict[str, str] = {spec["label"]: spec["id"] for spec in LABELS}
ID_TO_PREFIX: Dict[str, str] = {spec["id"]: spec["placeholder_prefix"] for spec in LABELS}


def placeholder(entity_id: str, idx: int) -> str:
    prefix = ID_TO_PREFIX.get(entity_id, entity_id.upper())
    return f"[MASKED_{prefix}_{idx:02d}]"
