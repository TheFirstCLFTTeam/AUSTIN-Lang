"""Unit tests for the pure masking pipeline (no DB, no HTTP)."""

from orchestrator.masking import (
    ManualSpan,
    ModelSpan,
    assign_placeholders,
    drop_model_spans_overlapping_manual,
    find_manual_masks,
    render_masked_text,
    resolve_overlaps,
)


def test_find_manual_masks_picks_up_alt_g_and_typed():
    text = "[MASK] called [MASKED_NAME_03] yesterday"
    masks = find_manual_masks("seg-1", text)
    assert [m.raw for m in masks] == ["[MASK]", "[MASKED_NAME_03]"]


def test_resolve_overlaps_keeps_longest():
    spans = [
        ModelSpan("s1", 0, 20, "Jonathan V. Sterling", "person name", 0.9),
        ModelSpan("s1", 9, 11, "V.",                     "person name", 0.7),
        ModelSpan("s1", 30, 40, "9988-1234",             "phone number", 0.8),
    ]
    kept = resolve_overlaps(spans)
    assert len(kept) == 2
    assert kept[0].text == "Jonathan V. Sterling"


def test_manual_mask_wins_over_model_span():
    model = [ModelSpan("s1", 0, 6, "[MASK]", "person name", 0.9)]
    manuals = {"s1": [ManualSpan("s1", 0, 6, "[MASK]")]}
    assert drop_model_spans_overlapping_manual(model, manuals) == []


def test_recurring_entity_gets_stable_token():
    spans = [
        ModelSpan("s1", 0, 5,  "Alice", "person name", 0.9),
        ModelSpan("s2", 0, 5,  "Alice", "person name", 0.9),
        ModelSpan("s2", 10, 13, "Bob",  "person name", 0.9),
    ]
    finals = assign_placeholders(spans, [], {"s1": "Alice", "s2": "Alice    Bob"})
    by_text = {f.original_text: f.placeholder for f in finals}
    assert by_text["Alice"] == "[MASKED_NAME_01]"
    assert by_text["Bob"]   == "[MASKED_NAME_02]"


def test_render_masked_text_substitutes_in_order():
    text = "Hi Alice, account 8838-4491-882 please"
    finals = assign_placeholders(
        [
            ModelSpan("s1", 3, 8,   "Alice",          "person name",     0.9),
            ModelSpan("s1", 18, 31, "8838-4491-882", "bank account id", 0.9),
        ],
        [],
        {"s1": text},
    )
    rendered = render_masked_text(text, finals)
    assert rendered == "Hi [MASKED_NAME_01], account [MASKED_BANK_ID_01] please"
