import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";

import HomePage from "./pages/HomePage";
import UploadPage from "./pages/UploadPage";
import SubmittedFilesPage from "./pages/SubmittedFilesPage";
import FileDetailPage from "./pages/FileDetailPage";
import LoginPage from "./pages/LoginPage";

import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Public route */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="files" element={<SubmittedFilesPage />} />
        <Route path="files/:id" element={<FileDetailPage />} />
      </Route>
    </Routes>
  );
}
