import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSubmittedFiles, deleteAudioFile } from "../services/api";

export default function SubmittedFilesPage() {
  const [files, setFiles] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = () => {
    fetchSubmittedFiles()
      .then(setFiles)
      .catch(error => console.error("Error setting files:", error));
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation(); // Prevent row click navigation
    
    if (window.confirm("Are you sure you want to delete this file and all its transcripts? This cannot be undone.")) {
      try {
        await deleteAudioFile(id);
        // Remove from local state
        setFiles(files.filter(f => f.id !== id));
      } catch (error) {
        alert("Failed to delete the file. Please try again.");
      }
    }
  };

  return (
    <>
      <h2 className="text-3xl font-semibold mb-6">
        Submitted Files
      </h2>

      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-6 py-3 font-medium text-gray-500">
                File Name
              </th>
              <th className="text-left px-6 py-3 font-medium text-gray-500">
                Upload Date
              </th>
              <th className="text-right px-6 py-3 font-medium text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan="3" className="px-6 py-10 text-center text-gray-500">
                  No files found. Upload some audio to get started!
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr
                  key={file.id}
                  className="hover:bg-gray-50 cursor-pointer border-b last:border-0"
                  onClick={() => navigate(`/files/${file.id}`)}
                >
                  <td className="px-6 py-4 font-medium">
                    {file.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {file.uploaded_at 
                      ? new Date(file.uploaded_at + " UTC").toLocaleString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) 
                      : "N/A"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={(e) => handleDelete(e, file.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete file"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
