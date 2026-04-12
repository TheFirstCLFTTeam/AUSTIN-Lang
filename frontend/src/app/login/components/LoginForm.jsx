'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../../../services/api";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
        <p className="mb-4 text-sm" style={{ color: "#ba1a1a" }}>
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-[0.875rem] font-medium mb-2" style={{ color: "#1c1b1b" }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="w-full px-3.5 py-3 text-[0.875rem] outline-none"
            style={{ backgroundColor: "#ffffff", border: "1px solid #d4d4d4", borderRadius: "6px", color: "#1c1b1b" }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={(e) => { e.target.style.borderColor = "#635bff"; }}
            onBlur={(e) => { e.target.style.borderColor = "#d4d4d4"; }}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="password" className="block text-[0.875rem] font-medium" style={{ color: "#1c1b1b" }}>
              Password
            </label>
            <button type="button" className="text-[0.8125rem] font-medium bg-transparent border-none cursor-pointer" style={{ color: "#635bff" }}>
              Forgot your password?
            </button>
          </div>
          <input
            id="password"
            type="password"
            required
            className="w-full px-3.5 py-3 text-[0.875rem] outline-none"
            style={{ backgroundColor: "#ffffff", border: "1px solid #d4d4d4", borderRadius: "6px", color: "#1c1b1b" }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={(e) => { e.target.style.borderColor = "#635bff"; }}
            onBlur={(e) => { e.target.style.borderColor = "#d4d4d4"; }}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
            style={{ accentColor: "#635bff", borderRadius: "3px" }}
          />
          <label htmlFor="rememberMe" className="text-[0.8125rem] cursor-pointer" style={{ color: "#555" }}>
            Remember me on this device
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 text-[0.9375rem] font-semibold cursor-pointer transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ backgroundColor: "#635bff", color: "#ffffff", border: "none", borderRadius: "6px" }}
          onMouseEnter={(e) => { if (!loading) e.target.style.backgroundColor = "#5147e5"; }}
          onMouseLeave={(e) => { if (!loading) e.target.style.backgroundColor = "#635bff"; }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </>
  );
}