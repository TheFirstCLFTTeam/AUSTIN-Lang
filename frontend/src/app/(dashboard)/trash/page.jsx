export default function TrashPage() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[0.75rem] mb-1" style={{ color: "#7a7574" }}>
        <span>HOME</span><span>/</span><span style={{ color: "#1c1b1b" }}>TRASH</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: "#1c1b1b", letterSpacing: "-0.02em" }}>TRASH</h1>
        <button className="px-3 py-1.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: "transparent", border: "1.5px solid rgba(233, 188, 181, 0.3)", borderRadius: "0px", color: "#7a7574" }}>
          EMPTY TRASH
        </button>
      </div>

      <div className="py-16 text-center" style={{ backgroundColor: "#ffffff" }}>
        <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.5">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <p className="text-[0.875rem] font-semibold mb-1" style={{ color: "#1c1b1b" }}>Trash is empty</p>
        <p className="text-[0.75rem]" style={{ color: "#7a7574" }}>Deleted recordings are retained for 7 calendar days per PDPA compliance, then permanently removed.</p>
      </div>
    </div>
  );
}
