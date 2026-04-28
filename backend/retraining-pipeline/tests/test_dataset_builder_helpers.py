"""Slice 4 helpers for the financial-terms dictionary integration into
the eval-manifest writer. Test contract:
    - stamp_critical_terms is pure (no I/O); given reference + snapshot,
      produces the matched-term list.
    - fetch_dictionary_snapshot is fail-quiet — returns (None, []) on
      every failure mode (HTTP 5xx, ConnectionError, malformed JSON).
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock


# Avoid importing the heavy training-data fetch path's deps (librosa, sf)
# by adding the package dir to the path and importing the helpers directly.
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from eval_manifest_helpers import (  # noqa: E402
    _phrase_in_tokens,
    _tokenise,
    fetch_dictionary_snapshot,
    stamp_critical_terms,
)


class TokeniseTests(unittest.TestCase):
    def test_lowercase_and_strip_punct(self):
        self.assertEqual(_tokenise("Hello, World! It's"), ["hello", "world", "it's"])

    def test_empty(self):
        self.assertEqual(_tokenise(""), [])
        self.assertEqual(_tokenise(None), [])

    def test_collapse_whitespace(self):
        self.assertEqual(_tokenise("  foo   bar  "), ["foo", "bar"])


class PhraseInTokensTests(unittest.TestCase):
    def test_single_token_match(self):
        self.assertTrue(_phrase_in_tokens(["ebitda"], ["our", "ebitda", "is"]))

    def test_single_token_no_match(self):
        self.assertFalse(_phrase_in_tokens(["ebitda"], ["our", "earnings", "is"]))

    def test_multi_word_contiguous_match(self):
        self.assertTrue(_phrase_in_tokens(["hedge", "fund"], ["the", "hedge", "fund", "filed"]))

    def test_multi_word_non_contiguous_no_match(self):
        self.assertFalse(_phrase_in_tokens(["hedge", "fund"], ["the", "hedge", "small", "fund"]))

    def test_empty_needle(self):
        self.assertFalse(_phrase_in_tokens([], ["anything"]))


class StampCriticalTermsTests(unittest.TestCase):
    def setUp(self):
        self.terms = [
            {"id": 1, "term": "EBITDA",     "term_normalized": "ebitda",     "category": "ratio",      "definition": None},
            {"id": 2, "term": "Q1",         "term_normalized": "q1",         "category": None,         "definition": None},
            {"id": 3, "term": "Hedge Fund", "term_normalized": "hedge fund", "category": "instrument", "definition": None},
        ]

    def test_returns_matching_terms_canonical_form(self):
        out = stamp_critical_terms("Our EBITDA is up in Q1.", self.terms)
        # EBITDA + Q1 should match; Hedge Fund should not.
        self.assertEqual(set(out), {"EBITDA", "Q1"})

    def test_multi_word_match(self):
        out = stamp_critical_terms("The hedge fund filed.", self.terms)
        self.assertEqual(out, ["Hedge Fund"])

    def test_empty_reference(self):
        self.assertEqual(stamp_critical_terms("", self.terms), [])
        self.assertEqual(stamp_critical_terms(None, self.terms), [])

    def test_empty_terms_list(self):
        self.assertEqual(stamp_critical_terms("EBITDA", []), [])

    def test_no_matches(self):
        self.assertEqual(stamp_critical_terms("the cat sat", self.terms), [])

    def test_punctuation_around_term(self):
        # "EBITDA," with trailing comma still tokenises to "ebitda"
        out = stamp_critical_terms("The (EBITDA), was up.", self.terms)
        self.assertEqual(out, ["EBITDA"])


class FetchSnapshotTests(unittest.TestCase):
    def test_happy_path(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "version": "2026-04-28T10:00:00Z",
            "term_count": 1,
            "terms": [{"id": 1, "term": "EBITDA", "term_normalized": "ebitda"}],
        }
        with patch("eval_manifest_helpers.requests.get", return_value=mock_resp):
            version, terms = fetch_dictionary_snapshot()
        self.assertEqual(version, "2026-04-28T10:00:00Z")
        self.assertEqual(len(terms), 1)
        self.assertEqual(terms[0]["term"], "EBITDA")

    def test_fail_quiet_on_500(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        with patch("eval_manifest_helpers.requests.get", return_value=mock_resp):
            version, terms = fetch_dictionary_snapshot()
        self.assertIsNone(version)
        self.assertEqual(terms, [])

    def test_fail_quiet_on_connection_error(self):
        with patch("eval_manifest_helpers.requests.get", side_effect=ConnectionError("boom")):
            version, terms = fetch_dictionary_snapshot()
        self.assertIsNone(version)
        self.assertEqual(terms, [])

    def test_fail_quiet_on_malformed_json(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.side_effect = ValueError("not json")
        with patch("eval_manifest_helpers.requests.get", return_value=mock_resp):
            version, terms = fetch_dictionary_snapshot()
        self.assertIsNone(version)
        self.assertEqual(terms, [])


if __name__ == "__main__":
    unittest.main()
