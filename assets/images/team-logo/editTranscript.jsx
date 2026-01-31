import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { BrowserRouter, Routes, Route } from "react-router-dom";
// import EditTranscript from "./editTranscript";

// export default function App() {
//   return (
//     <BrowserRouter>
//       <Routes>
//         <Route path="/transcripts/:id" element={<EditTranscript />} />
//       </Routes>
//     </BrowserRouter>
//   );
// }


const API_BASE = "http://localhost:8000";

export default function EditTranscript() {
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState("");
  const [edited, setEdited] = useState("");
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function fetchTranscript() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/transcripts/${id}`);
        if (!res.ok) throw new Error("Failed to load transcript");
        const data = await res.json();

        setOriginal(data.original_transcript || "");
        setEdited(data.edited_transcript || data.original_transcript || "");
        setStatus(data.status || "");
      } catch (e) {
        setMessage(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchTranscript();
  }, [id]);

  async function handleSubmit() {
    setMessage("");
    if (!edited.trim()) {
      setMessage("Edited transcript cannot be empty.");
      return;
    }

    const payload = {
      edited_transcript: edited,
      rating: rating ? Number(rating) : null,
      verified_by: "krystal.lim", // replace with your auth later
    };

    try {
      const res = await fetch(`${API_BASE}/transcripts/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to submit verification");
      }

      const updated = await res.json();
      setStatus(updated.status);
      setMessage("Saved ✅");
    } catch (e) {
      setMessage(e.message);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h2>Edit Transcript</h2>
      {status && <p><b>Status:</b> {status}</p>}

      <div style={{ marginTop: 16 }}>
        <label><b>Original transcript (read-only)</b></label>
        <textarea
          value={original}
          readOnly
          rows={6}
          style={{ width: "100%", marginTop: 8 }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label><b>Edited transcript</b></label>
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={10}
          style={{ width: "100%", marginTop: 8 }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label><b>Quality rating (optional)</b></label>
        <select
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          style={{ display: "block", marginTop: 8 }}
        >
          <option value="">—</option>
          <option value="1">1 (poor)</option>
          <option value="2">2</option>
          <option value="3">3 (ok)</option>
          <option value="4">4</option>
          <option value="5">5 (excellent)</option>
        </select>
      </div>

      <button onClick={handleSubmit} style={{ marginTop: 16 }}>
        Save / Verify
      </button>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}
    </div>
  );
}
