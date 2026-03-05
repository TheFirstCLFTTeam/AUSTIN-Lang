// src/pages/HomePage.jsx
import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-gradient-to-b from-blue-50 to-white px-6">

      {/* Logo */}
      <img
        src="/logo.png"        // Place your logo in the "public" folder as "logo.png"
        alt="AUSTIN-Lang Logo"
        className="w-64 h-64 object-contain mb-6"
      />

      {/* App Name */}
      <h1 className="text-5xl font-bold text-blue-700 mb-4 text-center">
        AUSTIN-Lang
      </h1>

      {/* Tagline */}
      <p className="text-gray-600 text-lg mb-8 text-center max-w-xl">
        Transform your audio into accurate transcriptions in seconds.
        Upload, review, and correct effortlessly.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          to="/upload"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
        >
          Upload Audio
        </Link>
        <Link
          to="/files"
          className="px-6 py-3 bg-white border border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition"
        >
          View Submitted Files
        </Link>
        <Link
          to="/dashboard"
          className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition"
        >
          Analytics Dashboard
        </Link>
      </div>
    </div>
  );
}