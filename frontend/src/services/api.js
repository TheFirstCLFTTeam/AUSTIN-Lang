// src/services/api.js

/*********************************
 * MOCK AUTH SECTION
 *********************************/

// Mock users (plain-text for demo only)
const users = [
  {
    id: "u1",
    email: "test@example.com",
    password: "password123",
    name: "Test User",
  },
];

// Token helpers
const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

// Mock login
export async function login(email, password) {
  const user = users.find(
    (u) => u.email === email && u.password === password
  );

  if (!user) {
    throw new Error("Invalid email or password");
  }

  // fake JWT
  const fakeToken = btoa(
    JSON.stringify({ id: user.id, email: user.email })
  );

  localStorage.setItem(TOKEN_KEY, fakeToken);

  return {
    token: fakeToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}

/*********************************
 * MOCK FILE DATABASE
 *********************************/

let files = [
  {
    id: "1",
    name: "sample-audio-1.wav",
    audioUrl: "/mock-audio/sample1.wav",
    transcript: "This is a sample transcription.",
  },
  {
    id: "2",
    name: "sample-audio-2.wav",
    audioUrl: "/mock-audio/sample2.wav",
    transcript: "Another example transcription.",
  },
];

// Simple auth guard for mock API calls
function requireAuth() {
  if (!isAuthenticated()) {
    throw new Error("Not authenticated");
  }
}

/*********************************
 * FILE API FUNCTIONS
 *********************************/

// Upload audio file
export async function uploadAudio(file) {
  requireAuth();

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("http://localhost:8001/transcribe/", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status: ${response.status}`);
    }

    const data = await response.json();

    const newFile = {
      id: data.id || Date.now().toString(),
      name: file.name,
      audioUrl: URL.createObjectURL(file),
      transcript: data.transcript || "Transcription in progress...",
      ...data
    };

    files.push(newFile);
    return newFile;
  } catch (error) {
    console.error("Error uploading file:", error);
    throw error;
  }
}

// Fetch all submitted files
export async function fetchSubmittedFiles() {
  requireAuth();
  return files;
}

// Fetch one file by ID
export async function fetchFileDetail(id) {
  requireAuth();
  return files.find((f) => f.id === id);
}

// Update transcript
export async function updateTranscript(id, newTranscript) {
  requireAuth();

  const file = files.find((f) => f.id === id);
  if (file) {
    file.transcript = newTranscript;
  }
  return file;
}
