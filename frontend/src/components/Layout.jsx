import { Link } from "react-router-dom";

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link to="/" className="text-xl font-bold tracking-tight">
            AUSTIN-Lang
          </Link>

          <div className="space-x-6 text-sm font-medium">
            <Link to="/upload" className="text-gray-600 hover:text-black">
              Upload
            </Link>
            <Link to="/files" className="text-gray-600 hover:text-black">
              Submitted Files
            </Link>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  );
}