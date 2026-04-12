import Link from "next/link";
import { fetchSubmittedFilesServer } from "../../../services/api-server";

export default async function RecentPage() {
  const data = await fetchSubmittedFilesServer();
  const files = data.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
        <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>RECENT</span>
      </div>
      <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>RECENT</h1>

      <div style={{ backgroundColor: "#ffffff" }}>
        <div className="flex items-center px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: "#7a7574", borderBottom: "1px solid rgba(233, 188, 181, 0.15)" }}>
          <div className="w-8" /><div className="flex-1">Name</div><div className="w-36">Last Accessed</div>
        </div>
        {files.map((file) => (
          <Link key={file.id} href={`/files/${file.id}`} className="flex items-center px-5 py-4 cursor-pointer hover:bg-[#f6f3f2] transition-colors no-underline" style={{ borderBottom: "1px solid rgba(233, 188, 181, 0.08)" }}>
            <div className="w-8">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <div className="flex-1"><p className="text-[0.8125rem] font-semibold" style={{ color: "#1c1b1b" }}>{file.name}</p></div>
            <div className="w-36 text-[0.75rem]" style={{ color: "#7a7574" }}>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "\u2014"}</div>
          </Link>
        ))}
        {files.length === 0 && (
          <div className="px-5 py-12 text-center text-[0.875rem]" style={{ color: "#7a7574" }}>No recent files.</div>
        )}
      </div>
    </div>
  );
}
