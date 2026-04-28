'use client';

import {
  formatAbsolute,
  formatPercent,
  getBaseFamilyMeta,
} from '@/services/mock_data-leaderboard';

function MetricTile({ label, value, sub }) {
  return (
    <div className="p-4" style={{ backgroundColor: '#f6f3f2' }}>
      <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-2" style={{ color: '#7a7574' }}>{label}</p>
      <p className="text-[1.5rem] font-bold" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>{value}</p>
      {sub && <p className="text-[0.625rem] mt-1" style={{ color: '#7a7574' }}>{sub}</p>}
    </div>
  );
}

function ReproBadge({ label, on }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 text-[0.5625rem] font-semibold uppercase tracking-widest"
      style={{
        backgroundColor: on ? 'rgba(178, 1, 0, 0.08)' : 'transparent',
        color: on ? '#b20100' : '#7a7574',
        border: `1px solid ${on ? 'rgba(178, 1, 0, 0.25)' : 'rgba(233, 188, 181, 0.3)'}`,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          backgroundColor: on ? '#b20100' : '#c4c4c4',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

export default function SubmissionDrawer({ submission, onClose }) {
  if (!submission) return null;
  const family = getBaseFamilyMeta(submission.baseFamily);
  const worst = submission.worstExamples || [];

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(28, 27, 27, 0.35)',
          zIndex: 40,
        }}
      />
      <aside
        className="flex flex-col"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 92vw)',
          backgroundColor: '#ffffff',
          boxShadow: '-8px 0 24px rgba(28, 27, 27, 0.08)',
          zIndex: 50,
          overflowY: 'auto',
        }}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-4" style={{ borderBottom: '2px solid #1c1b1b' }}>
          <div className="min-w-0">
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: '#b20100' }}>
              Submission · Rank #{submission.rank}
            </p>
            <h2 className="text-[1.25rem] font-bold tracking-tight mt-1" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
              {submission.modelName}
            </h2>
            <p className="text-[0.75rem] mt-1" style={{ color: '#7a7574' }}>
              {submission.engineerName} · {formatAbsolute(submission.submittedAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer"
            style={{
              background: 'transparent',
              border: '1.5px solid rgba(233, 188, 181, 0.3)',
              borderRadius: 0,
              width: '32px',
              height: '32px',
              color: '#1c1b1b',
              fontSize: '1.125rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="inline-block px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
                style={{ backgroundColor: family.color, color: '#ffffff' }}
              >
                {family.label}
              </span>
              <span className="text-[0.625rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
                {submission.submissionCount} submission{submission.submissionCount === 1 ? '' : 's'} on this dataset
              </span>
            </div>

            <div className="grid grid-cols-3" style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', gap: '1px' }}>
              <MetricTile label="WER" value={formatPercent(submission.wer)} sub="Primary · lower is better" />
              <MetricTile label="CER" value={formatPercent(submission.cer)} />
              <MetricTile label="RTF" value={submission.rtf.toFixed(2)} sub="Real-time factor" />
            </div>
          </div>

          <div>
            <h3 className="text-[0.75rem] font-bold uppercase tracking-widest mb-3" style={{ color: '#1c1b1b' }}>
              Reproducibility
            </h3>
            <div className="flex flex-wrap gap-2">
              <ReproBadge label="Config stored" on={!!submission.reproducibility?.config} />
              <ReproBadge label="Adapter checkpoint" on={!!submission.reproducibility?.checkpoint} />
              <ReproBadge label="Training notebook" on={!!submission.reproducibility?.notebook} />
            </div>
          </div>

          <div>
            <h3 className="text-[0.75rem] font-bold uppercase tracking-widest mb-3" style={{ color: '#1c1b1b' }}>
              Worst-error utterances
            </h3>
            {worst.length === 0 ? (
              <p className="text-[0.75rem] p-4" style={{ color: '#7a7574', backgroundColor: '#f6f3f2' }}>
                No high-error examples surfaced for this submission.
              </p>
            ) : (
              <div style={{ backgroundColor: '#f6f3f2' }}>
                {worst.map((ex, i) => (
                  <div
                    key={ex.id}
                    className="px-4 py-3"
                    style={i > 0 ? { borderTop: '1px solid rgba(233, 188, 181, 0.3)' } : undefined}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574' }}>
                        Utterance {i + 1}
                      </span>
                      <span className="text-[0.625rem] font-bold" style={{ color: '#b20100' }}>
                        {formatPercent(ex.utteranceWer)} WER
                      </span>
                    </div>
                    <p className="text-[0.75rem] mb-1" style={{ color: '#1c1b1b' }}>
                      <span className="text-[0.5625rem] uppercase tracking-widest mr-2" style={{ color: '#7a7574' }}>REF</span>
                      {ex.refText}
                    </p>
                    <p className="text-[0.75rem]" style={{ color: '#b20100' }}>
                      <span className="text-[0.5625rem] uppercase tracking-widest mr-2" style={{ color: '#7a7574' }}>PRED</span>
                      {ex.predText}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
