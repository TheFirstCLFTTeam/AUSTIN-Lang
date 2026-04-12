export default function StarredPage() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
        <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>STARRED</span>
      </div>
      <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>STARRED</h1>

      <div className="py-16 text-center" style={{ backgroundColor: "#ffffff" }}>
        <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <p className="text-[0.875rem] font-semibold mb-1" style={{ color: "#1c1b1b" }}>No starred transcripts</p>
        <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Star important transcripts from the file browser to access them quickly here.</p>
      </div>
    </div>
  );
}
