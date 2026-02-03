import requests
import os
import wave
from dotenv import load_dotenv

load_dotenv()

# Configuration
port = os.getenv("TRANSCRIPTION_ORCHESTRATOR_PORT", 8001)
URL = f"http://localhost:{port}/transcribe/"
TEST_FILE = "example.wav"

def test_upload():
    # Ensure test file exists
    if not os.path.exists(TEST_FILE):
        print('Error: File does not exist.')
        return

    print(f"Sending POST request to {URL}...")
    
    try:
        with open(TEST_FILE, "rb") as f:
            files = {"file": (TEST_FILE, f, "audio/wav")}
            response = requests.post(URL, files=files)

        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.json()}")

        if response.status_code == 200:
            print("Success")
        else:
            print("Fail")

    except requests.exceptions.ConnectionError as e: 
        print(f"Connection Error: {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_upload()
