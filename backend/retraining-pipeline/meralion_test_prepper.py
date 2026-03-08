import os
import json
import re
from pathlib import Path
from datasets import load_dataset
import soundfile as sf

# 1. Configuration
DATASET_NAME = "MERaLiON/Multitask-National-Speech-Corpus-v1"
CONFIG_NAME = "ASR-PART3-Test"
SPLIT = "train"
NUM_SAMPLES = 20  # Limit for initial test

# Directories
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
AUDIO_DIR = DATA_DIR / "meralion_audio"
MANIFEST_PATH = DATA_DIR / "meralion_manifest.jsonl"

DATA_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(exist_ok=True)

def clean_transcript(text: str) -> str:
    """
    Cleans MERaLiON transcripts:
    - Removes <SpeakerX>: tags
    - Removes [ah], [lah] etc. brackets if desired (keeping for now as domain terms)
    - Normalizes whitespace
    """
    # Remove Speaker tags: <Speaker1>: 
    text = re.sub(r"<Speaker\d+>:", "", text)
    # Remove newlines
    text = text.replace("\n", " ").replace("\r", " ")
    # Optional: Remove specific annotations like [ah] or (uh)
    # text = re.sub(r"\[.*?\]", "", text)
    # text = re.sub(r"\(.*?\)", "", text)
    
    # Normalize multiple spaces
    text = " ".join(text.split())
    return text.strip()

import io
from datasets import load_dataset, Audio
import soundfile as sf
import librosa

# ... (keep config and clean_transcript as is)

def prepare_meralion():
    print(f"Loading dataset {DATASET_NAME} ({CONFIG_NAME})...")
    try:
        # Disable automatic decoding to avoid torchcodec/ffmpeg DLL issues
        dataset = load_dataset(DATASET_NAME, CONFIG_NAME, split=SPLIT, streaming=True)
        dataset = dataset.cast_column("context", Audio(decode=False))
    except Exception as e:
        print(f"Error loading dataset: {e}")
        return

    manifest = []
    count = 0

    print(f"Preparing {NUM_SAMPLES} samples...")
    for item in dataset:
        if count >= NUM_SAMPLES:
            break
            
        row_idx = count
        audio_dict = item["context"] 
        # audio_dict will have {'path': ..., 'bytes': ...} because decode=False
        
        raw_answer = item["answer"]
        cleaned_text = clean_transcript(raw_answer)
        
        # Save audio file locally
        audio_filename = f"meralion_{row_idx}.wav"
        audio_path = AUDIO_DIR / audio_filename
        
        try:
            # Decode manually from bytes
            audio_bytes = audio_dict['bytes']
            with io.BytesIO(audio_bytes) as b:
                data, samplerate = sf.read(b)
                # Ensure 16kHz
                if samplerate != 16000:
                    data = librosa.resample(data, orig_sr=samplerate, target_sr=16000)
                    samplerate = 16000
                sf.write(audio_path, data, samplerate)
        except Exception as decode_err:
            print(f"Failed to decode sample {count}: {decode_err}")
            continue
        
        manifest.append({
            "audio_path": str(audio_path.absolute()),
            "sentence": cleaned_text
        })
        
        print(f"Sample {count}: {cleaned_text[:60]}...")
        count += 1

    # Save manifest
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        for entry in manifest:
            f.write(json.dumps(entry) + "\n")

    print(f"\nSuccess! Manifest created with {len(manifest)} samples at {MANIFEST_PATH}")
    print(f"Audio files stored in {AUDIO_DIR}")

if __name__ == "__main__":
    prepare_meralion()
