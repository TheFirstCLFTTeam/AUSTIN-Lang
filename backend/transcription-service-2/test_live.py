import requests
import json
import os

def test_live_transcription():
    url = "http://localhost:8004/transcribe"
    # audio_path = os.path.join("harvard.wav")
    audio_path = os.path.join("harvard.wav")
    
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        return

    print(f"Transcribing {audio_path}...")
    
    with open(audio_path, 'rb') as f:
        files = {'audio': (os.path.basename(audio_path), f, 'audio/wav')}
        response = requests.post(url, files=files)
    
    if response.status_code == 200:
        result = response.json()
        print("\n--- Transcription Result ---")
        print(f"Full Text: {result['text']}")
        print("\n--- Segments ---")
        for chunk in result.get('chunks', []):
            print(f"[{chunk['start']:5.2f}s -> {chunk['end']:5.2f}s] {chunk['text']}")
    else:
        print(f"Error: {response.status_code}")
        print(response.text)

if __name__ == "__main__":
    test_live_transcription()
