import os
import requests
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DB_URL = f"http://localhost:{os.getenv('DATABASE_PORT', 8002)}"
AUDIO_SERVICE_URL = f"http://localhost:{os.getenv('AUDIO_SUBMISSION_PORT', 8000)}"

# Local directory to store temp training data
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
AUDIO_DIR = DATA_DIR / "audio_clips"
AUDIO_DIR.mkdir(exist_ok=True)

def fetch_training_data():
    """
    1. Fetch all audio files from DB.
    2. For each audio file, fetch its edited transcript.
    3. Download audio file locally.
    4. Save a manifest (jsonl) for training.
    """
    print("Fetching training data from database...")
    
    # 1. Get all audio files
    try:
        response = requests.get(f"{DB_URL}/audio-files/")
        response.raise_for_status()
        audio_files = response.json()
    except Exception as e:
        print(f"Failed to fetch audio files: {e}")
        return []

    manifest = []

    for af in audio_files:
        af_id = af['id']
        filename = af['file_name']
        
        # 2. Get raw transcripts to find the edited ones
        # (Assuming the system structure: Audio -> Raw -> Edited)
        try:
            raw_resp = requests.get(f"{DB_URL}/raw-transcripts/?audio_file_id={af_id}")
            raw_resp.raise_for_status()
            raw_transcripts = raw_resp.json()
            
            if not raw_transcripts:
                continue
            
            raw_id = raw_transcripts[0]['id']
            
            # 3. Get edited transcript
            edited_resp = requests.get(f"{DB_URL}/edited-transcripts/?raw_transcript_id={raw_id}")
            edited_resp.raise_for_status()
            edited_transcripts = edited_resp.json()
            
            if not edited_transcripts:
                continue
            
            # Get full text from segments
            segments = edited_transcripts[0]['transcript_segments']
            full_text = " ".join([seg['text'] for seg in segments])
            
            # 4. Download audio
            audio_path = AUDIO_DIR / filename
            if not audio_path.exists():
                print(f"Downloading {filename}...")
                audio_dl_resp = requests.get(f"{AUDIO_SERVICE_URL}/audio_files/{filename}")
                audio_dl_resp.raise_for_status()
                with open(audio_path, "wb") as f:
                    f.write(audio_dl_resp.content)

            manifest.append({
                "audio_path": f"data/audio_clips/{filename}",
                "sentence": full_text
            })

        except Exception as e:
            print(f"Skipping {filename} due to error: {e}")
            continue

    # Save manifest
    manifest_path = DATA_DIR / "manifest.jsonl"
    with open(manifest_path, "w", encoding="utf-8") as f:
        for entry in manifest:
            f.write(json.dumps(entry) + "\n")

    print(f"Manifest created with {len(manifest)} samples at {manifest_path}")
    return manifest

if __name__ == "__main__":
    fetch_training_data()
