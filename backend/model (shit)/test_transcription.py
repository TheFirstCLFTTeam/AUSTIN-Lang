import requests
import os

def test_transcription():
    url = "http://127.0.0.1:8000/v1/audio/transcriptions"
    
    # Create a dummy audio file if one doesn't exist for testing purposes
    # In a real scenario, the user should provide a path to a real audio file
    audio_file_path = "test_audio.wav"
    
    if not os.path.exists(audio_file_path):
        print(f"Please place an audio file named '{audio_file_path}' in this directory to test.")
        # We can't easily generate a valid mp3 without external libs, so we'll ask user/wait for one
        return

    files = {
        'file': (audio_file_path, open(audio_file_path, 'rb'), 'audio/mpeg'),
    }
    data = {
        'model': 'deepdml/faster-whisper-large-v3-turbo-ct2'
    }

    try:
        response = requests.post(url, files=files, data=data)
        response.raise_for_status()
        print("Transcription Result:")
        print(response.json())
    except requests.exceptions.RequestException as e:
        print(f"Error during transcription request: {e}")

if __name__ == "__main__":
    test_transcription()
