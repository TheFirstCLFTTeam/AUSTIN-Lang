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

  try {
    // 1. Call the Orchestrator which handles upload, transcription, and DB registration
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("http://localhost:8001/transcribe/", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Orchestrator failed: ${response.status}`);
    }

    const data = await response.json();

    // 2. Construct the file object for frontend display
    // Using the real segments returned from Whisper
    const newFile = {
      id: String(data.audio_file_id), 
      name: file.name,
      audioUrl: `http://localhost:8000/audio_files/${file.name}`,
      transcriptSegments: data.transcription.segments || [], 
    };

    return newFile;
  } catch (error) {
    console.error("Error in uploadAudio workflow:", error);
    throw error;
  }
}

// Fetch all submitted files
export async function fetchSubmittedFiles() {
  requireAuth();
  try {
    const response = await fetch("http://localhost:8002/audio-files/"); // Call the new backend endpoint
    if (!response.ok) {
      throw new Error(`Failed to fetch audio files: ${response.status}`);
    }
    const audioFiles = await response.json();
    
    // Map the backend AudioFile array to the structure the UI expects
    return audioFiles.map((audioFile) => ({
      id: String(audioFile.id), // Ensure ID is a string for frontend consistency
      name: audioFile.file_name,
      // audioUrl will need to be configured based on where your audio files are served
      // For now, assuming a similar structure as before but targeting port 8000
      audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`, 
      transcriptSegments: [], // Summary view, full segments fetched in detail
      uploaded_at: audioFile.uploaded_at
    }));
  } catch (error) {
    console.error("Error fetching submitted files:", error);
    return [];
  }
}

// Fetch one file by ID
export async function fetchFileDetail(id) {
  requireAuth();
  try {
    // 1. Fetch AudioFile
    const audioFileResponse = await fetch(`http://localhost:8002/audio-files/${id}`);
    if (!audioFileResponse.ok) {
      throw new Error(`Failed to fetch audio file detail for ID ${id}: ${audioFileResponse.status}`);
    }
    const audioFile = await audioFileResponse.json();

    // 2. Fetch Raw Transcript(s) for this audio_file_id
    // Assuming one raw transcript per audio file for simplicity
    const rawTranscriptsResponse = await fetch(`http://localhost:8002/raw-transcripts/?audio_file_id=${id}`);
    if (!rawTranscriptsResponse.ok) {
        throw new Error(`Failed to fetch raw transcripts for audio file ID ${id}: ${rawTranscriptsResponse.status}`);
    }
    const rawTranscripts = await rawTranscriptsResponse.json();
    const rawTranscript = rawTranscripts.length > 0 ? rawTranscripts[0] : null; // Get the first one

    let editedTranscript = null;
    if (rawTranscript) {
        // 3. Fetch Edited Transcript(s) for this raw_transcript_id
        // Assuming one edited transcript per raw transcript for simplicity
        const editedTranscriptsResponse = await fetch(`http://localhost:8002/edited-transcripts/?raw_transcript_id=${rawTranscript.id}`);
        if (!editedTranscriptsResponse.ok) {
            throw new Error(`Failed to fetch edited transcripts for raw transcript ID ${rawTranscript.id}: ${editedTranscriptsResponse.status}`);
        }
        const editedTranscripts = await editedTranscriptsResponse.json();
        editedTranscript = editedTranscripts.length > 0 ? editedTranscripts[0] : null; // Get the first one
    }

    // Combine all data into the frontend's expected file structure
    const fileDetail = {
      id: String(audioFile.id),
      name: audioFile.file_name,
      audioUrl: `http://localhost:8000/audio_files/${audioFile.file_name}`, // Adjust as per your audio serving setup
      uploaded_at: audioFile.uploaded_at,
      rawTranscript: rawTranscript, // Include raw transcript data
      editedTranscript: editedTranscript, // Include edited transcript data
      transcriptSegments: editedTranscript 
        ? editedTranscript.transcript_segments 
        : (rawTranscript ? rawTranscript.transcript_segments : []),
    };

    return fileDetail;

  } catch (error) {
    console.error("Error fetching file detail:", error);
    return null;
  }
}

// Update transcript
export async function updateTranscript(editedTranscriptId, rawTranscriptId, newSegments = []) {
  requireAuth();
  try {
    const processedSegments = newSegments.map(segment => ({
      ...segment,
      id: Number.isInteger(Number(segment.id)) ? Number(segment.id) : null // Convert to int or null
    }));

    const response = await fetch(`http://localhost:8002/edited-transcripts/${editedTranscriptId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw_transcript_id: rawTranscriptId,
        transcript_segments: processedSegments,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update transcript: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error updating transcript:", error);
    throw error;
  }
}

