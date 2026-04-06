import os
import requests
import json
import librosa
import soundfile as sf
from dotenv import load_dotenv

load_dotenv()

DB_URL = f"http://localhost:{os.getenv('DATABASE_PORT', 8002)}"
AUDIO_SERVICE_URL = f"http://localhost:{os.getenv('AUDIO_SUBMISSION_PORT', 8000)}"

# Local directory to store temp training data
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

ADAPTER_NAME = os.getenv("ADAPTER_NAME")
AUDIO_DIR = os.path.join(DATA_DIR, ADAPTER_NAME)
os.makedirs(AUDIO_DIR, exist_ok=True)

def fetch_training_data():
    """
    1. Fetch all audio files from DB.
    2. For each audio file, fetch its edited transcript segments.
    3. Download the full audio file locally.
    4. Slice the audio into small segments (Whisper prefers <30s).
    5. Save a manifest (jsonl) for training.
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
        
        try:
            # 2. Get raw transcripts to find the edited ones
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
            
            # 4. Get segments from edited transcript
            segments = edited_transcripts[0]['transcript_segments']
            if not segments:
                continue

            # 5. Download full audio
            temp_full_path = os.path.join(AUDIO_DIR, f"temp_{filename}")
            if not os.path.exists(temp_full_path):
                print(f"Downloading full audio {filename}...")
                audio_dl_resp = requests.get(f"{AUDIO_SERVICE_URL}/audio_files/{filename}")
                audio_dl_resp.raise_for_status()
                with open(temp_full_path, "wb") as f:
                    f.write(audio_dl_resp.content)

            # 6. Slice audio into ~30s chunks
            print(f"Slicing {filename} into ~30s chunks...")
            audio_data, sr = librosa.load(temp_full_path, sr=16000)

            current_chunk_segments = []
            chunk_start_time = None
            target_duration = 28.0 # Slightly under 30s to be safe

            for i, seg in enumerate(segments):
                if chunk_start_time is None:
                    chunk_start_time = seg['start']
                
                current_chunk_segments.append(seg)
                chunk_end_time = seg['end']
                
                # If we've reached the target duration OR it's the last segment
                if (chunk_end_time - chunk_start_time >= target_duration) or (i == len(segments) - 1):
                    # Process the accumulated chunk
                    full_text = " ".join([s['text'].strip() for s in current_chunk_segments if s['text'].strip()])
                    
                    if full_text:
                        # Extract slice
                        start_sample = int(chunk_start_time * sr)
                        end_sample = int(chunk_end_time * sr)
                        audio_slice = audio_data[start_sample:end_sample]

                        # Save chunk
                        chunk_filename = f"chunk_{len(manifest)}_{filename}"
                        chunk_path = os.path.join(AUDIO_DIR, chunk_filename)
                        sf.write(chunk_path, audio_slice, sr)

                        manifest.append({
                            "audio_path": f"data/{ADAPTER_NAME}/{chunk_filename}",
                            "sentence": full_text
                        })

                    # Reset for next chunk
                    current_chunk_segments = []
                    chunk_start_time = None

            # Clean up temp full audio to save space
            os.remove(temp_full_path)

        except Exception as e:
            print(f"Skipping {filename} due to error: {e}")
            continue

    # Save manifest
    manifest_path = os.path.join(DATA_DIR, f"{ADAPTER_NAME}_manifest.jsonl")
    with open(manifest_path, "w", encoding="utf-8") as f:
        for entry in manifest:
            f.write(json.dumps(entry) + "\n")

    print(f"Manifest created with {len(manifest)} samples at {manifest_path}")
    return manifest

if __name__ == "__main__":
    fetch_training_data()
