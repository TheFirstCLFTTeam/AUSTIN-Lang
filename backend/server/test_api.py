"""
Test script for the transcription API.
Sends a sample audio file to the server and prints the transcription result.
"""

import sys
from pathlib import Path

import requests


def test_health(base_url: str):
    """Test the health endpoint."""
    response = requests.get(f"{base_url}/health")
    print(f"Health Check: {response.json()}")
    return response.ok


def test_transcription(base_url: str, audio_path: str, language: str = None):
    """Test transcription with an audio file."""
    if not Path(audio_path).exists():
        print(f"Error: Audio file not found: {audio_path}")
        return False
    
    print(f"\nTranscribing: {audio_path}")
    
    with open(audio_path, "rb") as f:
        files = {"audio": (Path(audio_path).name, f, "audio/mpeg")}
        params = {}
        if language:
            params["language"] = language
        params["include_segments"] = "true"
        
        response = requests.post(
            f"{base_url}/transcribe",
            files=files,
            params=params,
        )
    
    if response.ok:
        result = response.json()
        print(f"\n{'='*50}")
        print(f"Transcription Result:")
        print(f"{'='*50}")
        print(f"Language: {result.get('language', 'N/A')}")
        print(f"Duration: {result.get('duration', 'N/A')} seconds")
        print(f"\nText:\n{result['text']}")
        
        if result.get("segments"):
            print(f"\n{'='*50}")
            print("Segments:")
            for seg in result["segments"]:
                print(f"  [{seg['start']:.2f}s - {seg['end']:.2f}s]: {seg['text']}")
        return True
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return False


def main():
    base_url = "http://localhost:8000"
    
    # Parse arguments
    audio_path = sys.argv[1] if len(sys.argv) > 1 else None
    language = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"Testing transcription API at {base_url}\n")
    
    # Test health
    if not test_health(base_url):
        print("Server is not healthy!")
        return
    
    # Test transcription if audio file provided
    if audio_path:
        test_transcription(base_url, audio_path, language)
    else:
        print("\nNo audio file provided. Usage:")
        print("  python test_api.py <audio_file> [language_code]")
        print("\nExample:")
        print("  python test_api.py sample.mp3")
        print("  python test_api.py sample.wav en")


if __name__ == "__main__":
    main()
