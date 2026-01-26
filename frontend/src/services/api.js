// src/services/api.js

// Mock in-memory "database"
let files = [
  {
    id: "1",
    name: "sample-audio-1.wav",
    audioUrl: "/mock-audio/sample1.wav",
    transcript: "This is a sample transcription."
  },
  {
    id: "2",
    name: "sample-audio-2.wav",
    audioUrl: "/mock-audio/sample2.wav",
    transcript: "Another example transcription."
  }
];

// Upload audio file
export async function uploadAudio(file) {
  const newFile = {
    id: Date.now().toString(),
    name: file.name,
    audioUrl: URL.createObjectURL(file),
    transcript: "Transcription will appear here..."
  };

  files.push(newFile);
  return newFile;
}

// Fetch all submitted files
export async function fetchSubmittedFiles() {
  return files;
}

// Fetch one file by ID
export async function fetchFileDetail(id) {
  return files.find((f) => f.id === id);
}

// Update transcript
export async function updateTranscript(id, newTranscript) {
  const file = files.find((f) => f.id === id);
  if (file) {
    file.transcript = newTranscript;
  }
  return file;
}