import requests
import json
import os

def test_orchestrated_transcription(audio_file="cantonese2.wav", language="yue", domain=None):
    # Route through the Orchestrator to ensure DB registration and full workflow
    url = "http://localhost:8001/transcribe/"
    audio_path = os.path.join(audio_file)
    
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        return

    print(f"Triggering orchestrated transcription for {audio_path}...")
    print(f"Parameters - language: {language}, domain: {domain}")
    
    with open(audio_path, 'rb') as f:
        # Orchestrator expects the file field to be named 'file'
        files = {'file': (os.path.basename(audio_path), f, 'audio/mpeg')}
        data = {}
        if language:
            data['language'] = language
        if domain:
            data['domain'] = domain
            
        response = requests.post(url, files=files, data=data)
    
    if response.status_code == 200:
        result = response.json()
        print("\n--- Orchestration Success ---")
        print(f"Audio File ID: {result['audio_file_id']}")
        print(f"Raw Transcript ID: {result['raw_transcript_id']}")
        print(f"Edited Transcript ID: {result['edited_transcript_id']}")
        
        whisper_data = result.get('transcription', {})
        print(f"\nFull Text: {whisper_data.get('text', '')}")
        
        print("\n--- Segments ---")
        # Orchestrator maps 'chunks' to 'segments' for consistency
        for segment in whisper_data.get('segments', []):
            start = segment.get('start') if segment.get('start') is not None else 0.0
            end = segment.get('end') if segment.get('end') is not None else 0.0
            print(f"[{start:5.2f}s -> {end:5.2f}s] {segment['text']}")
    else:
        print(f"Error: {response.status_code}")
        try:
            print(json.dumps(response.json(), indent=2))
        except:
            print(response.text)

if __name__ == "__main__":
    # You can change these values to test different scenarios
    test_orchestrated_transcription(
        audio_file="cantonese2.wav", 
        language="yue", 
        domain=None # e.g., "fypaudio-W-largev3turbo"
    )
