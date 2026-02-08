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
    name: "sample1.wav",
    audioUrl: "/sample1.wav", // ✅ REAL FILE NOW
    transcriptSegments: [
      {
        id: "seg-1",
        start: 0,
        end: 4,
        text: "This is a sample transcription."
      },
      {
        id: "seg-2",
        start: 4,
        end: 8,
        text: "It is split into timestamped segments."
      },
      {
        id: "seg-3",
        start: 8,
        end: 12,
        text: "Each segment can be edited and clicked."
      }
    ]
  }
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

  const newFile = {
    id: Date.now().toString(),
    name: file.name,
    audioUrl: URL.createObjectURL(file),
    transcript: "Transcription will appear here...",
  };

  files.push(newFile);
  return newFile;
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
export async function updateTranscript(id, newSegments) {
  requireAuth();
  const file = files.find((f) => f.id === id);
  if (file) {
    file.transcriptSegments = newSegments;
  }
  return file;
}

