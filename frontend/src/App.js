import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import UploadPage from "./pages/UploadPage";
import SubmittedFilesPage from "./pages/SubmittedFilesPage";
import FileDetailPage from "./pages/FileDetailPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/files" element={<SubmittedFilesPage />} />
        <Route path="/files/:id" element={<FileDetailPage />} />
      </Routes>
    </Layout>
  );
}