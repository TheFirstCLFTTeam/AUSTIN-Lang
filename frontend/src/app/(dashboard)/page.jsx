import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <img src="/logo.png" alt="AUSTIN-Lang Logo" className="w-40 h-40 object-contain mb-6" />

      <h1
        className="text-[2.5rem] font-bold mb-2 text-center"
        style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}
      >
        AUSTIN-Lang
      </h1>

      <p className="text-[0.875rem] mb-10 text-center max-w-md" style={{ color: "#7a7574" }}>
        Automated Speech Recognition for financial compliance.
        Upload, transcribe, review, and improve.
      </p>

      <div className="flex gap-4">
        <Link
          href="/upload"
          className="px-6 py-3 text-[0.8125rem] font-semibold no-underline"
          style={{ background: "linear-gradient(135deg, #b20100, #e10000)", color: "#ffffff", borderRadius: "0px" }}
        >
          Upload Audio
        </Link>
        <Link
          href="/files"
          className="px-6 py-3 text-[0.8125rem] font-medium no-underline"
          style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
        >
          My Transcripts
        </Link>
        <Link
          href="/dashboard"
          className="px-6 py-3 text-[0.8125rem] font-medium no-underline"
          style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#1c1b1b" }}
        >
          Analytics Dashboard
        </Link>
      </div>
    </div>
  );
}
