'use client';

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../services/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const particlesRef = useRef([]);
  const animFrameRef = useRef(null);

  const getSlantTop = useCallback((x) => {
    // Match the slant overlay: top 50%, skewY(-3deg), origin at left=-5vw
    // At viewport x, element-local x = x + 0.05 * window.innerWidth
    const localX = x + 0.05 * window.innerWidth;
    return window.innerHeight * 0.5 - localX * Math.tan(3 * Math.PI / 180);
  }, []);

  const initParticles = useCallback(() => {
    const particles = [];
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * window.innerWidth;
      const topY = getSlantTop(x);
      const y = topY + Math.random() * (window.innerHeight - topY);
      particles.push({
        x,
        y,
        baseX: x,
        baseY: y,
        size: Math.random() * 4 + 2,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.4 + 0.1,
        hue: Math.random() * 10 + 370, // blue-purple range
      });
    }
    particlesRef.current = particles;
  }, [getSlantTop]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    initParticles();

    const handleMouseMove = (e) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mouse = mouseRef.current;
      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Drift slowly
        p.baseX += p.speedX;
        p.baseY += p.speedY;

        // Wrap around edges (constrained to slant region)
        if (p.baseX < -20) p.baseX = canvas.width + 20;
        if (p.baseX > canvas.width + 20) p.baseX = -20;
        const slantY = getSlantTop(p.baseX);
        if (p.baseY < slantY - 20) p.baseY = canvas.height + 20;
        if (p.baseY > canvas.height + 20) p.baseY = slantY + Math.random() * (canvas.height - slantY);

        // React to mouse - push away gently
        const dx = mouse.x - p.baseX;
        const dy = mouse.y - p.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 180;

        if (dist < maxDist) {
          const force = (1 - dist / maxDist) * 60;
          p.x = p.baseX - (dx / dist) * force;
          p.y = p.baseY - (dy / dist) * force;
        } else {
          p.x += (p.baseX - p.x) * 0.05;
          p.y += (p.baseY - p.y) * 0.05;
        }

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 60%, 70%, ${p.opacity})`;
        ctx.fill();

        // Draw connections between nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const cdx = p.x - p2.x;
          const cdy = p.y - p2.y;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

          if (cdist < 150) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `hsla(220, 50%, 70%, ${0.12 * (1 - cdist / 150)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [initParticles, getSlantTop]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err.message || "Login failed");
    }
  };

  return (
    <div
      className="min-h-screen relative"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Full-screen wallpaper background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/login_wallpaper.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* Slanted overlay */}
      <div className="absolute inset-0" style={{ overflow: "hidden" }}>
        <div
          className="absolute"
          style={{
            top: "50%",
            left: "-5%",
            right: "-5%",
            bottom: "-10000%",
            backgroundColor: "rgba(247, 247, 247, 0.95)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            transformOrigin: "top left",
            transform: "skewY(-3deg)",
          }}
        />
      </div>

      {/* Interactive particles */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          zIndex: 5,
          pointerEvents: "none",
          clipPath: "polygon(0% 50%, 100% calc(50% - 5.5vw), 100% 100%, 0% 100%)",
        }}
      />

      {/* Centered card */}
      <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10" style={{ zIndex: 10 }}>
        <div
          className="w-full max-w-[520px] overflow-hidden"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.55)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.5)",
          }}
        >
          {/* Card content */}
          <div className="px-12 pt-10 pb-8">
            <div className="flex justify-start mb-8">
              <img src="/logo.png" alt="CLFT" className="h-10 object-contain" />
            </div>

            <h1
              className="text-[1.625rem] font-semibold mb-8"
              style={{ color: "#1c1b1b", letterSpacing: "-0.01em" }}
            >
              Sign in to your account
            </h1>

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
                className="w-full py-3 text-[0.9375rem] font-semibold cursor-pointer transition-colors"
                style={{ backgroundColor: "#635bff", color: "#ffffff", border: "none", borderRadius: "6px" }}
                onMouseEnter={(e) => { e.target.style.backgroundColor = "#5147e5"; }}
                onMouseLeave={(e) => { e.target.style.backgroundColor = "#635bff"; }}
              >
                Sign in
              </button>
            </form>

            <div className="flex items-center my-6">
              <div className="flex-1 h-px" style={{ backgroundColor: "#e0e0e0" }} />
              <span className="px-4 text-[0.75rem] uppercase tracking-wider" style={{ color: "#999" }}>or</span>
              <div className="flex-1 h-px" style={{ backgroundColor: "#e0e0e0" }} />
            </div>

            <div className="space-y-3">
              <button type="button" className="w-full flex items-center justify-center gap-2 py-2.5 text-[0.875rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #d4d4d4", borderRadius: "6px", color: "#1c1b1b" }}>
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
              <button type="button" className="w-full flex items-center justify-center gap-2 py-2.5 text-[0.875rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #d4d4d4", borderRadius: "6px", color: "#1c1b1b" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1c1b1b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="0" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Sign in with passkey
              </button>
              <button type="button" className="w-full flex items-center justify-center gap-2 py-2.5 text-[0.875rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1px solid #d4d4d4", borderRadius: "6px", color: "#1c1b1b" }}>
                Sign in with SSO
              </button>
            </div>
          </div>

          {/* Footer */}
          <div
            className="text-center px-12 py-5"
            style={{ backgroundColor: "rgba(240, 240, 240, 0.5)" }}
          >
            <p className="text-[0.8125rem]" style={{ color: "#7a7574" }}>
              New to AUSTIN-Lang?{" "}
              <button type="button" className="font-semibold bg-transparent border-none cursor-pointer" style={{ color: "#635bff" }}>
                 Request an account 
              </button>
            </p>
          </div>
        </div>

      </div>

      {/* Page footer */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 py-4 text-[0.75rem]"
        style={{ color: "rgba(120, 120, 120, 1.0)", backgroundColor: "#ffffff", zIndex: 10 }}
      >
        <span>AUSTIN-Lang v0.1.0</span>
        <div className="flex items-center gap-4">
          <button type="button" className="bg-transparent border-none cursor-pointer text-[0.75rem]" style={{ color: "rgba(120, 120, 120, 0.8)" }}>Privacy</button>
          <button type="button" className="bg-transparent border-none cursor-pointer text-[0.75rem]" style={{ color: "rgba(120, 120, 120, 0.8)" }}>Terms</button>
          <button type="button" className="bg-transparent border-none cursor-pointer text-[0.75rem]" style={{ color: "rgba(120, 120, 120, 0.8)" }}>Help</button>
        </div>
      </div>
    </div>
  );
}
