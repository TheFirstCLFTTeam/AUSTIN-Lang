# ERD Changes Implementation Plan

Based on the [21 Jan 2026 Meeting Minutes](file:///c:/Users/ChunChunMaru/Desktop/AUSTIN-Lang/undocs/Meeting%20minutes/21Jan2026sponsormeet.md), the following changes are proposed for [system_erd.plantuml](file:///c:/Users/ChunChunMaru/Desktop/AUSTIN-Lang/diagrams/system_erd.plantuml).

---

## 1. User Types Refinement

- [x] **Add `VERIFIER` subtype entity** – 3 user categories identified: uploader, verifier (risk team), developers
  - Fields: `user_id` (FK), `department`, `verification_scope` (e.g., payments, orders)

- [x] **Add `COMMERCIAL_USER_ACCESS_LEVEL` entity** (defines access tiers for commercial users)
  - `id`: int (PK)
  - `name`: string (e.g., "basic", "standard", "premium")
  - `description`: string
  - `max_uploads_per_day`: int
  - `max_storage_mb`: int

- [x] **Add `access_level_id`** (FK) to `COMMERCIAL_USER`
  - Links commercial users to their access tier

---

## 2. Recording Metadata & Security

- [x] **Expand `RECORDING_METADATA`** – add:
  - `call_origin`: string ("internal" / "external")
  - `phone_number`: string

- [x] **Add `is_cid_stripped` flag** to `RECORDING` or `TRANSCRIPTION`
  - Indicates if personally identifiable data (CID) has been masked

### Call Type Categorization (Lookup Tables)

- [x] **Add `CALL_TYPE_CATEGORY` entity** (lookup table for category types)
  - `id`: int (PK)
  - `name`: string (e.g., "purpose", "transaction_type", "risk_level")
  - `description`: string

- [x] **Add `CALL_TYPE_VALUE` entity** (available values for each category)
  - `id`: int (PK)
  - `category_id`: int (FK to CALL_TYPE_CATEGORY)
  - `value`: string (e.g., "business_call", "bank_transfer", "large_investment")
  - `description`: string

- [x] **Add `RECORDING_CALL_TYPE` entity** (associative entity linking recordings to call types)
  - `recording_id`: int (FK to RECORDING)
  - `call_type_value_id`: int (FK to CALL_TYPE_VALUE)

- [x] **Add relationships**:
  - `CALL_TYPE_CATEGORY` ||--o{ `CALL_TYPE_VALUE` : has_values
  - `RECORDING` ||--o{ `RECORDING_CALL_TYPE` : categorized_as
  - `CALL_TYPE_VALUE` ||--o{ `RECORDING_CALL_TYPE` : applies_to

> **Example categories**: Purpose (business call, inquiry), Transaction Type (bank transfer, investment order), Risk Level (standard, elevated, high)

## 3. Retention & Deletion Logging

- [x] **Enforce 7 calendar day retention** in `RECORDING_RETENTION`
  - Ensure `delete_at` is calculated as `upload_timestamp + 7 days`

- [x] **Add `DELETION_LOG` entity**
  - `id`: int (PK)
  - `recording_id`: int (FK)
  - `deleted_at`: datetime
  - `deleted_by`: int (FK to USER)

---

## 4. Transcription Enhancements

- [x] **Add `corrected_content` field** to `TRANSCRIPTION`
  - Stores user-submitted corrections for retraining

- [x] **Add `missing_terms` field** to `TRANSCRIPTION`
  - Flags terms that compliance requires but are absent

---

## 5. Model Training & Security

- [x] **Add `data_zone` attribute** to `MODEL_WEIGHTS`
  - Values: "green" (no CID access) or "red" (CID access)

- [x] **Add `FINANCIAL_TERM_DICTIONARY` entity**
  - `id`: int (PK)
  - `term`: string
  - `category`: string (domain-specific)
  - `language`: string

---

## 6. Access Control

- [x] **Add `data_zone` attribute** to `BACKEND_ENGINEER`
  - Distinguishes green-zone (least privilege) vs red-zone (CID access) engineers

---

## 7. Call Statistics (Rollup Table)

- [x] **Add `DAILY_CALL_STATISTICS` entity** (rollup/aggregate table)
  - `id`: int (PK)
  - `date`: date
  - `total_calls`: int
  - `avg_duration_seconds`: decimal
  - `min_duration_seconds`: int
  - `max_duration_seconds`: int
  - `std_deviation_seconds`: decimal
  - `total_corrections`: int
  - `total_flagged_violations`: int
    - Tracks calls with positive risk identified (e.g., legal exposure, political figures)

---

## 8. Synthetic Data Generation

- [x] **Add `REAL_DATA_PAIR` entity** (tracks real recording + transcription pairs)
  - `id`: int (PK)
  - `recording_id`: int (FK to RECORDING)
  - `transcription_id`: int (FK to TRANSCRIPTION)
  - `created_at`: datetime

- [x] **Add `SYNTHETIC_DATA_PAIR` entity** (tracks synthetic pairs generated from real pairs)
  - `id`: int (PK)
  - `real_data_pair_id`: int (FK to REAL_DATA_PAIR)
  - `synthetic_recording_url`: string
  - `synthetic_transcription`: text
  - `created_at`: datetime
  - `generation_module_version`: string

- [x] **Add relationship**: `REAL_DATA_PAIR` ||--o{ `SYNTHETIC_DATA_PAIR` : generates
  - One real pair can generate many synthetic pairs

> **Note**: A module takes a real recording + transcription pair and creates one or more synthetic recording + transcription pairs (for CID-free training data).

---

## Priority

| Priority | Change                                                  | Status |
| -------- | ------------------------------------------------------- | ------ |
| High     | `DELETION_LOG`, 7-day retention enforcement             | ✅ Done |
| High     | `data_zone` on `BACKEND_ENGINEER` and `MODEL_WEIGHTS`   | ✅ Done |
| Medium   | `VERIFIER` subtype                                      | ✅ Done |
| Medium   | `is_cid_stripped`, `corrected_content`, `missing_terms` | ✅ Done |
| Low      | `FINANCIAL_TERM_DICTIONARY`, expanded metadata          | ✅ Done |
