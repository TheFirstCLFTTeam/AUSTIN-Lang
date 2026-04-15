'use client';

import { useState, useEffect } from 'react';
import { fetchProcessingJobs } from '@/services/api';

const STATUS_STYLES = {
  processing: { bg: 'rgba(178, 1, 0, 0.08)',   color: '#b20100', label: 'PROCESSING' },
  queued:     { bg: 'rgba(122, 117, 116, 0.1)', color: '#7a7574', label: 'QUEUED' },
  completed:  { bg: 'rgba(0, 120, 70, 0.08)',   color: '#007846', label: 'COMPLETED' },
  failed:     { bg: 'rgba(200, 0, 0, 0.08)',    color: '#c80000', label: 'FAILED' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.queued;
  return (
    <span
      className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold tracking-wider"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="#7a7574" strokeWidth="2"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="1.75">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ProcessingPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    fetchProcessingJobs()
      .then((data) => setJobs(data || []))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeCount = jobs.filter((j) => j.status === 'processing').length;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const recordingCount = jobs.reduce((n, j) => n + (j.recordings?.length || 0), 0);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: '#7a7574' }}>
        <span className="uppercase tracking-wider" style={{ color: '#b20100' }}>HOME</span>
        <span>/</span>
        <span className="uppercase tracking-wider">Processing</span>
      </div>

      <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
        Processing Queue
      </h1>

      {/* Summary cards */}
      <div className="flex gap-4 mb-6">
        <SummaryCard label="Active Jobs" value={activeCount} color="#b20100" />
        <SummaryCard label="Queued" value={queuedCount} color="#7a7574" />
        <SummaryCard label="Failed" value={failedCount} color="#c80000" />
        <SummaryCard label="Recordings" value={recordingCount} color="#1c1b1b" />
      </div>

      {/* Job list */}
      {loading ? (
        <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Loading...</p>
      ) : jobs.length === 0 ? (
        <div className="p-8 text-center" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>No processing jobs right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-center px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
            <span className="w-6" />
            <span className="flex-1">Job</span>
            <span className="w-24 text-center">Recordings</span>
            <span className="w-28 text-center">Status</span>
            <span className="w-48">Progress</span>
            <span className="w-36 text-right">Submitted</span>
          </div>

          {jobs.map((job) => {
            const isOpen = expanded.has(job.id);
            const style = STATUS_STYLES[job.status] || STATUS_STYLES.queued;
            const recs = job.recordings || [];
            return (
              <div key={job.id} style={{ backgroundColor: '#ffffff' }}>
                {/* Collapsed / surface row */}
                <button
                  type="button"
                  onClick={() => toggle(job.id)}
                  className="w-full flex items-center px-5 py-4 text-left hover:bg-[#faf7f6] transition-colors"
                >
                  <span className="w-6 flex items-center">
                    <Chevron open={isOpen} />
                  </span>

                  {/* Job name + origin */}
                  <div className="flex-1 min-w-0 pr-3">
                    <p className="text-[0.8125rem] font-semibold truncate" style={{ color: '#1c1b1b' }}>
                      {job.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <SourceIcon />
                      <p className="text-[0.6875rem] truncate" style={{ color: '#7a7574' }}>
                        {job.source}
                        {job.submittedBy && <span className="mx-1.5">·</span>}
                        {job.submittedBy && <span>{job.submittedBy}</span>}
                      </p>
                    </div>
                  </div>

                  {/* Recording count */}
                  <div className="w-24 text-center">
                    <p className="text-[0.8125rem] font-medium" style={{ color: '#1c1b1b' }}>
                      {recs.length}
                    </p>
                    <p className="text-[0.625rem] uppercase tracking-wider" style={{ color: '#7a7574' }}>
                      {recs.length === 1 ? 'file' : 'files'}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="w-28 flex justify-center">
                    <StatusBadge status={job.status} />
                  </div>

                  {/* Progress */}
                  <div className="w-48 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5" style={{ backgroundColor: '#f6f3f2' }}>
                        <div
                          className="h-1.5 transition-all"
                          style={{
                            width: `${job.progress}%`,
                            backgroundColor: job.status === 'failed' ? '#c80000' : '#b20100',
                          }}
                        />
                      </div>
                      <span className="text-[0.6875rem] font-medium w-8 text-right" style={{ color: '#7a7574' }}>
                        {job.progress}%
                      </span>
                    </div>
                    <p className="text-[0.625rem] mt-1 truncate" style={{ color: job.status === 'failed' ? '#c80000' : '#7a7574' }}>
                      {job.stage}
                    </p>
                  </div>

                  {/* Submitted */}
                  <div className="w-36 text-right">
                    <p className="text-[0.6875rem]" style={{ color: '#7a7574' }}>
                      {formatTime(job.submittedAt)}
                    </p>
                    {job.estimatedCompletion && (
                      <p className="text-[0.625rem] mt-0.5" style={{ color: '#7a7574' }}>
                        ETA {formatTime(job.estimatedCompletion)}
                      </p>
                    )}
                  </div>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <div className="px-5 pb-4" style={{ borderTop: '1px solid #f0ebea' }}>
                    {/* Meta strip */}
                    <div className="flex flex-wrap gap-x-8 gap-y-2 py-3 text-[0.6875rem]" style={{ color: '#7a7574' }}>
                      <MetaItem label="Source">{job.source}</MetaItem>
                      <MetaItem label="Path" mono>{job.sourcePath}</MetaItem>
                      <MetaItem label="Submitted by">{job.submittedBy}</MetaItem>
                      <MetaItem label="Language">{job.language}</MetaItem>
                    </div>

                    {/* Recording list header */}
                    <div className="flex items-center px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
                      <span className="flex-1">Recording</span>
                      <span className="w-24">Duration</span>
                      <span className="w-20 text-right">Size</span>
                      <span className="w-28 text-center">Status</span>
                      <span className="w-40">Stage</span>
                      <span className="w-16 text-right">Progress</span>
                    </div>

                    {recs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center px-3 py-2 text-[0.75rem]"
                        style={{ backgroundColor: '#faf7f6', marginBottom: 2 }}
                      >
                        <span className="flex-1 truncate" style={{ color: '#1c1b1b' }}>
                          {r.fileName}
                        </span>
                        <span className="w-24" style={{ color: '#7a7574' }}>{r.duration}</span>
                        <span className="w-20 text-right" style={{ color: '#7a7574' }}>
                          {r.sizeMb.toFixed(1)} MB
                        </span>
                        <span className="w-28 flex justify-center">
                          <StatusBadge status={r.status} />
                        </span>
                        <span
                          className="w-40 truncate text-[0.6875rem]"
                          style={{ color: r.status === 'failed' ? '#c80000' : '#7a7574' }}
                        >
                          {r.stage}
                        </span>
                        <span className="w-16 text-right font-medium" style={{ color: '#1c1b1b' }}>
                          {r.progress}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, children, mono }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.6rem] uppercase tracking-wider" style={{ color: '#a39e9c' }}>{label}</span>
      <span
        className="text-[0.75rem]"
        style={{ color: '#1c1b1b', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}
      >
        {children || '—'}
      </span>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="px-5 py-4 min-w-[120px]" style={{ backgroundColor: '#ffffff' }}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>{label}</p>
      <p className="text-[1.5rem] font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
