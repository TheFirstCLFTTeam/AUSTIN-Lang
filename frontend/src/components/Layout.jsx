import { Link, useNavigate, Outlet } from "react-router-dom";
import { logout } from "../services/api";

export default function Layout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link to="/" className="text-xl font-bold tracking-tight">
            AUSTIN-Lang
          </Link>

          <div className="flex items-center space-x-6 text-sm font-medium">
            <Link to="/upload" className="text-gray-600 hover:text-black">
              Upload
            </Link>
            <Link to="/files" className="text-gray-600 hover:text-black">
              Submitted Files
            </Link>

            <button
              onClick={handleLogout}
              className="text-red-600 hover:text-red-700 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
