import pytest
from calculator import calculate_wer, aggregate_metrics

def test_calculate_wer_normalization():
    """Verify that WER calculation handles casing and punctuation via normalization."""
    # These should be identical after normalization
    reference = "Hello world! This is a test."
    hypothesis = "hello world this is a test"
    
    # Expected WER should be 0.0 because of normalization
    wer = calculate_wer(reference, hypothesis)
    assert wer == 0.0

def test_calculate_wer_mismatch():
    reference = "The quick brown fox"
    hypothesis = "The slow blue fox"
    # quick -> slow (1 sub), brown -> blue (1 sub)
    # 2 substitutions / 4 words = 0.5
    wer = calculate_wer(reference, hypothesis)
    assert wer == 0.5

def test_aggregate_metrics_exclusion():
    """Verify that unedited files are excluded and WER is averaged correctly."""
    data = [
        {
            "id": 1,
            "is_user_edited": 1,
            "raw_text": "Hello world",
            "edited_text": "Hello world",
            "transcription_started_at": "2023-01-01T10:00:00",
            "transcription_ended_at": "2023-01-01T10:00:05",
            "uploaded_at": "2023-01-01T09:59:50"
        },
        {
            "id": 2,
            "is_user_edited": 0, # Should be ignored for WER
            "raw_text": "Ignore me",
            "edited_text": "Some edit",
            "transcription_started_at": "2023-01-01T11:00:00",
            "transcription_ended_at": "2023-01-01T11:00:10",
            "uploaded_at": "2023-01-01T10:59:50"
        },
        {
            "id": 3,
            "is_user_edited": 1,
            "raw_text": "The quick brown fox",
            "edited_text": "The slow blue fox",
            "transcription_started_at": "2023-01-01T12:00:00",
            "transcription_ended_at": "2023-01-01T12:00:05",
            "uploaded_at": "2023-01-01T11:59:50"
        }
    ]
    
    metrics = aggregate_metrics(data)
    
    # WER: (0.0 + 0.5) / 2 = 0.25
    assert metrics["average_wer"] == 0.25
    assert metrics["total_files"] == 3
    assert metrics["files_with_edits"] == 2
    
    # Latency:
    # File 1: Start(10:00:00) - Upload(09:59:50) = 10s
    # File 2: Start(11:00:00) - Upload(10:59:50) = 10s
    # File 3: Start(12:00:00) - Upload(11:59:50) = 10s
    # Avg Queue Latency = 10s
    assert metrics["average_queue_latency"] == 10.0
    
    # Transcription Time:
    # File 1: 5s, File 2: 10s, File 3: 5s
    # Avg = (5+10+5)/3 = 6.666...
    assert pytest.approx(metrics["average_transcription_time"], 0.01) == 6.67
