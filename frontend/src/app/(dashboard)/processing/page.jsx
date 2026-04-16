'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchProcessingJobs, getCurrentUser } from '@/services/api';
import { watchJob, unwatchJob, isWatching, subscribe as subscribeNotifications } from '@/services/notifications';

const STATUS_STYLES = {
  processing: { bg: 'rgba(178, 1, 0, 0.08)',   color: '#b20100', label: 'PROCESSING' },
  queued:     { bg: 'rgba(122, 117, 116, 0.1)', color: '#7a7574', label: 'QUEUED' },
  completed:  { bg: 'rgba(0, 120, 70, 0.08)',   color: '#007846', label: 'COMPLETED' },
  failed:     { bg: 'rgba(200, 0, 0, 0.08)',    color: '#c80000', label: 'FAILED' },
};

const TICKET_RECIPIENT = 'support@ubs.com';

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

/* ── Watch bell with confirmation tooltip ── */
function WatchButton({ watching, onToggle }) {
  const [tooltip, setTooltip] = useState(null); // 'watching' | 'unwatched' | null
  const timerRef = useRef(null);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  const handleClick = (e) => {
    e.stopPropagation();
    const willWatch = !watching;
    onToggle(e);
    setTooltip(willWatch ? 'watching' : 'unwatched');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, 2200);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const label = watching ? 'Stop watching this job' : 'Notify me when complete';

  return (
    <span className="relative shrink-0">
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick(e); }}
        className="flex items-center justify-center w-5 h-5 transition-colors"
        style={{ cursor: 'pointer' }}
        title={label}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={watching ? '#b20100' : 'none'} stroke={watching ? '#b20100' : '#7a7574'} strokeWidth="1.75" strokeLinecap="square" strokeLinejoin="miter">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </span>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute left-1/2 bottom-full mb-2 px-3 py-2 whitespace-nowrap"
          style={{
            transform: 'translateX(-50%)',
            backgroundColor: '#1c1b1b',
            borderRadius: '6px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
            zIndex: 20,
          }}
        >
          <div className="flex items-center gap-1.5">
            {tooltip === 'watching' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            <span className="text-[0.6875rem] font-medium" style={{ color: '#ffffff' }}>
              {tooltip === 'watching'
                ? "You\u2019ll be notified when this job completes"
                : 'Notifications turned off for this job'}
            </span>
          </div>
          {/* Arrow */}
          <div
            className="absolute left-1/2"
            style={{
              bottom: '-4px',
              transform: 'translateX(-50%) rotate(45deg)',
              width: '8px',
              height: '8px',
              backgroundColor: '#1c1b1b',
            }}
          />
        </div>
      )}
    </span>
  );
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ── Error tooltip for failed recordings ── */
const TOOLTIP_LINGER_MS = 150; // delay before tooltip disappears after mouse leaves

function ErrorStage({ recording, jobName, onOpenTicket }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef(null);
  const triggerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const show = () => {
    clearTimeout(hideTimerRef.current);
    setShowTooltip(true);
  };

  const hideWithDelay = () => {
    hideTimerRef.current = setTimeout(() => setShowTooltip(false), TOOLTIP_LINGER_MS);
  };

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  const err = recording.error;
  if (!err) {
    return (
      <span className="w-40 truncate text-[0.6875rem]" style={{ color: '#c80000' }}>
        {recording.stage}
      </span>
    );
  }

  return (
    <span className="w-40 relative" ref={triggerRef}>
      <span
        className="truncate text-[0.6875rem] underline decoration-dotted underline-offset-2 cursor-pointer block"
        style={{ color: '#c80000' }}
        onMouseEnter={show}
        onMouseLeave={hideWithDelay}
      >
        {recording.stage}
      </span>

      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute right-0 bottom-full mb-2 z-30 p-4"
          style={{
            backgroundColor: '#1c1b1b',
            borderRadius: '8px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            width: '340px',
          }}
          onMouseEnter={show}
          onMouseLeave={hideWithDelay}
        >
          {/* Error code + timestamp */}
          <div className="flex items-center justify-between mb-2">
            <span
              className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-bold tracking-wider"
              style={{ backgroundColor: 'rgba(200, 0, 0, 0.3)', color: '#ff6b6b' }}
            >
              {err.code}
            </span>
            <span className="text-[0.5625rem]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {formatTime(err.timestamp)}
            </span>
          </div>

          {/* Error message */}
          <p className="text-[0.75rem] leading-relaxed mb-3" style={{ color: '#ffffff' }}>
            {err.message}
          </p>

          {/* Common causes */}
          {err.commonCauses?.length > 0 && (
            <div className="mb-3">
              <p className="text-[0.625rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Common causes
              </p>
              <ul className="space-y-1">
                {err.commonCauses.map((cause, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[0.6875rem] leading-snug" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <span className="shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>•</span>
                    {cause}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Log ticket CTA */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip(false);
              onOpenTicket({ recording, jobName, error: err });
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[0.6875rem] font-semibold cursor-pointer"
            style={{
              backgroundColor: 'rgba(200, 0, 0, 0.2)',
              border: '1px solid rgba(200, 0, 0, 0.4)',
              borderRadius: '4px',
              color: '#ff6b6b',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(200, 0, 0, 0.35)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(200, 0, 0, 0.2)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Log Support Ticket
          </button>
        </div>
      )}
    </span>
  );
}

/* ── Support ticket modal ── */
function FailureTicketModal({ recording, jobName, error, onCancel, onProceed }) {
  const defaultSubject = `Processing failure: ${error.code} — ${recording.fileName}`;
  const defaultBody =
    `Hi team,\n\n` +
    `A recording failed to process and I'd like to report it for investigation.\n\n` +
    `Job: ${jobName}\n` +
    `Recording: ${recording.fileName}\n` +
    `Error Code: ${error.code}\n` +
    `Error Message: ${error.message}\n` +
    `Failed At: ${error.timestamp}\n\n` +
    `Additional context:\n` +
    `(Please describe any additional details here)\n\n` +
    `Thanks.`;

  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(28, 27, 27, 0.45)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg flex flex-col"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e8e4e3',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3" style={{ borderBottom: '1px solid #e8e4e3' }}>
          <div className="flex items-center gap-2 mb-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c80000" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-[1rem] font-bold" style={{ color: '#1c1b1b' }}>
              Log a support ticket
            </h3>
          </div>
          <p className="text-[0.75rem] mt-1" style={{ color: '#7a7574' }}>
            Review the pre-filled details below. Proceed to open this in your mail client addressed to{' '}
            <span style={{ color: '#1c1b1b', fontWeight: 600 }}>{TICKET_RECIPIENT}</span>.
          </p>
        </div>

        {/* Error summary strip */}
        <div className="mx-6 mt-4 px-3 py-2.5 flex items-start gap-3" style={{ backgroundColor: 'rgba(200, 0, 0, 0.04)', border: '1px solid rgba(200, 0, 0, 0.12)', borderRadius: '6px' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[0.625rem] font-bold tracking-wider px-1.5 py-0.5" style={{ backgroundColor: 'rgba(200, 0, 0, 0.08)', color: '#c80000' }}>
                {error.code}
              </span>
              <span className="text-[0.6875rem] font-medium truncate" style={{ color: '#1c1b1b' }}>
                {recording.fileName}
              </span>
            </div>
            <p className="text-[0.6875rem] leading-snug" style={{ color: '#7a7574' }}>
              {error.message}
            </p>
          </div>
        </div>

        {/* Form fields */}
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
              To
            </label>
            <div
              className="mt-1 px-3 py-2 text-[0.8125rem]"
              style={{ backgroundColor: '#f6f3f2', borderRadius: '6px', color: '#1c1b1b' }}
            >
              {TICKET_RECIPIENT}
            </div>
          </div>
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-[0.8125rem]"
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e8e4e3',
                borderRadius: '6px',
                color: '#1c1b1b',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full px-3 py-2 text-[0.8125rem] leading-relaxed resize-none"
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e8e4e3',
                borderRadius: '6px',
                color: '#1c1b1b',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-6 py-4"
          style={{ borderTop: '1px solid #e8e4e3' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid #e8e4e3',
              borderRadius: '6px',
              color: '#1c1b1b',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onProceed({ to: TICKET_RECIPIENT, subject, body })}
            className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, #b20100, #e10000)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
            }}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState(null);
  const [, forceUpdate] = useState(0);
  const [ticketData, setTicketData] = useState(null);

  useEffect(() => {
    fetchProcessingJobs()
      .then((data) => setJobs(data || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return subscribeNotifications(() => forceUpdate((n) => n + 1));
  }, []);

  const toggleWatch = (e, job) => {
    e.stopPropagation();
    const user = getCurrentUser();
    if (isWatching(job.id)) {
      unwatchJob(job.id);
    } else {
      watchJob({ jobId: job.id, jobName: job.name, userId: user?.id || 'u1' });
    }
  };

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
        <SummaryCard label="Active Jobs" value={activeCount} color="#b20100" active={filter === 'processing'} onClick={() => setFilter(filter === 'processing' ? null : 'processing')} />
        <SummaryCard label="Queued" value={queuedCount} color="#7a7574" active={filter === 'queued'} onClick={() => setFilter(filter === 'queued' ? null : 'queued')} />
        <SummaryCard label="Failed" value={failedCount} color="#c80000" active={filter === 'failed'} onClick={() => setFilter(filter === 'failed' ? null : 'failed')} />
        <SummaryCard label="Recordings" value={recordingCount} color="#1c1b1b" />
      </div>

      {/* Job list */}
      {loading ? (
        <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Loading...</p>
      ) : jobs.length === 0 ? (
        <div className="p-8 text-center" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>No processing jobs right now.</p>
        </div>
      ) : (() => {
        const filteredJobs = filter ? jobs.filter((j) => j.status === filter) : jobs;
        return (
        <div className="space-y-2">
          {filter && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[0.6875rem] uppercase tracking-wider" style={{ color: '#7a7574' }}>
                Showing {filteredJobs.length} {filter} {filteredJobs.length === 1 ? 'job' : 'jobs'}
              </span>
              <button
                onClick={() => setFilter(null)}
                className="text-[0.6875rem] font-semibold uppercase tracking-wider cursor-pointer"
                style={{ backgroundColor: 'transparent', border: 'none', color: '#b20100' }}
              >
                Clear Filter
              </button>
            </div>
          )}

          {filteredJobs.length === 0 ? (
            <div className="p-8 text-center" style={{ backgroundColor: '#ffffff' }}>
              <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>No {filter} jobs.</p>
            </div>
          ) : (
          <>
          {/* Header */}
          <div className="flex items-center px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
            <span className="w-6" />
            <span className="flex-1">Job</span>
            <span className="w-24 text-center">Recordings</span>
            <span className="w-28 text-center">Status</span>
            <span className="w-48">Progress</span>
            <span className="w-36 text-right">Submitted</span>
          </div>

          {filteredJobs.map((job) => {
            const isOpen = expanded.has(job.id);
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
                    <div className="flex items-center gap-2">
                      <p className="text-[0.8125rem] font-semibold truncate" style={{ color: '#1c1b1b' }}>
                        {job.name}
                      </p>
                      {job.status !== 'completed' && (
                        <WatchButton
                          watching={isWatching(job.id)}
                          onToggle={(e) => toggleWatch(e, job)}
                        />
                      )}
                    </div>
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
                        {r.status === 'failed' && r.error ? (
                          <ErrorStage
                            recording={r}
                            jobName={job.name}
                            onOpenTicket={(data) => setTicketData(data)}
                          />
                        ) : (
                          <span
                            className="w-40 truncate text-[0.6875rem]"
                            style={{ color: r.status === 'failed' ? '#c80000' : '#7a7574' }}
                          >
                            {r.stage}
                          </span>
                        )}
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
          </>
          )}
        </div>
        );
      })()}

      {/* Failure ticket modal */}
      {ticketData && (
        <FailureTicketModal
          recording={ticketData.recording}
          jobName={ticketData.jobName}
          error={ticketData.error}
          onCancel={() => setTicketData(null)}
          onProceed={({ to, subject, body }) => {
            window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            setTicketData(null);
          }}
        />
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

function SummaryCard({ label, value, color, active, onClick }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`px-5 py-4 min-w-[120px] transition-colors ${clickable ? 'cursor-pointer' : ''}`}
      style={{
        backgroundColor: active ? '#1c1b1b' : '#ffffff',
        borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
      }}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: active ? 'rgba(255,255,255,0.6)' : '#7a7574' }}>{label}</p>
      <p className="text-[1.5rem] font-bold" style={{ color: active ? '#ffffff' : color }}>{value}</p>
    </div>
  );
}
