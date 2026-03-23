import jiwer
from typing import List, Dict, Optional
import datetime

# Define a normalization pipeline: lower case, remove punctuation
normalization = jiwer.Compose([
    jiwer.ToLowerCase(),
    jiwer.RemovePunctuation(),
    jiwer.RemoveMultipleSpaces(),
    jiwer.ReduceToListOfListOfWords(),
])

def calculate_wer(reference: str, hypothesis: str) -> float:
    """Calculates WER between two strings with normalization."""
    if not reference or not hypothesis:
        return 1.0 if reference != hypothesis else 0.0
    
    return jiwer.wer(
        reference, 
        hypothesis, 
        reference_transform=normalization, 
        hypothesis_transform=normalization
    )

def parse_iso(dt_str: Optional[str]) -> Optional[datetime.datetime]:
    if not dt_str:
        return None
    try:
        # Handle cases where Z or +00:00 might be present
        return datetime.datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
    except ValueError:
        return None

def aggregate_metrics(data: List[Dict]) -> Dict:
    """
    Calculates aggregated metrics from bulk context data.
    - Average WER (only for is_user_edited=1)
    - Average Queue Latency (transcription_started_at - uploaded_at)
    - Average Transcription Time (transcription_ended_at - transcription_started_at)
    """
    total_files = len(data)
    if total_files == 0:
        return {
            "average_wer": None,
            "average_queue_latency": None,
            "average_transcription_time": None,
            "total_files": 0,
            "files_with_edits": 0
        }

    wer_scores = []
    queue_latencies = []
    transcription_times = []
    files_with_edits = 0

    for item in data:
        # 1. WER Calculation
        if item.get("is_user_edited") == 1:
            files_with_edits += 1
            raw = item.get("raw_text") or ""
            edited = item.get("edited_text") or ""
            wer_scores.append(calculate_wer(edited, raw)) # Reference is the edited (ground truth)

        # 2. Timing Calculations
        uploaded_at = parse_iso(item.get("uploaded_at"))
        started_at = parse_iso(item.get("transcription_started_at"))
        ended_at = parse_iso(item.get("transcription_ended_at"))

        if started_at and uploaded_at:
            queue_latencies.append((started_at - uploaded_at).total_seconds())
        
        if ended_at and started_at:
            transcription_times.append((ended_at - started_at).total_seconds())

    return {
        "average_wer": sum(wer_scores) / len(wer_scores) if wer_scores else None,
        "average_queue_latency": sum(queue_latencies) / len(queue_latencies) if queue_latencies else None,
        "average_transcription_time": sum(transcription_times) / len(transcription_times) if transcription_times else None,
        "total_files": total_files,
        "files_with_edits": files_with_edits
    }
