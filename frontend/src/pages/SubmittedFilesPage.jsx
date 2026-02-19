import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSubmittedFiles } from "../services/api";

export default function SubmittedFilesPage() {
  const [files, setFiles] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSubmittedFiles().then(setFiles);
  }, []);

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
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/files/${file.id}`)}
              >
                <td className="px-6 py-4 font-medium">
                  {file.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}