from fastapi import FastAPI, UploadFile, File, HTTPException
import os
import requests

app = FastAPI()

@app.post("/transcribe/")
async def transcribe(file: UploadFile = File(...)):
    """
    Upload an audio file (must be .wav).

    Usage (HTML Form):
    ```html
    <form action="http://localhost:8000/transcribe/" method="post" enctype="multipart/form-data">
        <input name="file" type="file" accept=".wav">
        <button type="submit">Upload audio</button>
    </form>
    ```

    Usage (Python):
    ```python
    import requests

    url = "http://localhost:8001/transcribe/"
    files = {"file": open("audio.wav", "rb")}
    response = requests.post(url, files=files)
    print(response.json())
    ```
    """
    # Call audio submission api
    print('test')
    audio_submission_port = os.getenv("AUDIO_SUBMISSION_PORT", 8000)
    url = f"http://audio_submission:{audio_submission_port}/upload-audio/"
    file_content = await file.read()
    files = {"file": (file.filename, file_content, file.content_type)}
    response = requests.post(url, files=files)

    # TODO: Make a transcription request


    return response.json()

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("TRANSCRIPTION_ORCHESTRATOR_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)