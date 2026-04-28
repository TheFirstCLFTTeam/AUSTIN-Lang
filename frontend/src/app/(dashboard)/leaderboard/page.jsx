'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/services/api';
import { SAMPLED_DATASET_FOLDERS } from '@/services/sampled-datasets';
import { getDatasets, subscribeDatasets } from '@/services/datasets';
import { getAccessPermsGroupForUser, getGroupsForUser } from '@/services/user-groups';
import {
  formatPercent,
  formatRelative,
  formatAbsolute,
  getBaseFamilyMeta,
  getLeaderboard,
  getLeaderboardDatasets,
} from '@/services/mock_data-leaderboard';
import {
  MOCK_CUSTOM_DATASETS,
  getCustomMockLeaderboard,
  hasCustomMockLeaderboard,
} from '@/services/mock_data-leaderboard-custom';
import SubmissionDrawer from './SubmissionDrawer';

const HEADER_TOOLTIPS = {
  engineer: 'The engineer in your user group who submitted this model. The row with a "You" badge is yours.',
  model: 'The model lineage string — base model + any adapters, in the engineer\'s own naming. The colored chip shows the base-model family.',
  wer: 'Word Error Rate on the dataset\'s held-out evaluation split. Lower is better. Primary ranking metric — rows are sorted by this.',
  cer: 'Character Error Rate on the same split. Lower is better. Useful when tokenisation differs across languages (e.g. Cantonese vs. English).',
  rtf: 'Real-Time Factor: seconds of wall-clock time per second of audio at inference. Lower is faster. Measured on the group\'s standard eval hardware.',
  last: 'Time since this engineer\'s latest submission on this dataset. Hover for the exact timestamp.',
};

const TOOLTIP_WIDTH = 240;
const TOOLTIP_MARGIN = 12;
const TOOLTIP_EST_HEIGHT = 96;

function Tooltip({ label, children }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  // `hAlign` is which edge of the tooltip is pinned to the trigger: 'left' means
  // tooltip's left edge aligns with trigger's left edge (default); 'right' means
  // the tooltip's right edge aligns with the trigger's right edge (flipped when
  // a left-aligned tooltip would overflow the right side of the viewport).
  // `vAlign` handles the same for the vertical axis.
  const [hAlign, setHAlign] = useState('left');
  const [vAlign, setVAlign] = useState('below');

  const measure = () => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.left + TOOLTIP_WIDTH + TOOLTIP_MARGIN > vw) {
      setHAlign('right');
    } else {
      setHAlign('left');
    }

    if (rect.bottom + TOOLTIP_EST_HEIGHT + TOOLTIP_MARGIN > vh) {
      setVAlign('above');
    } else {
      setVAlign('below');
    }
  };

  const handleOpen = () => {
    measure();
    setOpen(true);
  };
  const handleClose = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const handler = () => measure();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open]);

  const tooltipStyle = {
    position: 'absolute',
    [vAlign === 'below' ? 'top' : 'bottom']: 'calc(100% + 6px)',
    [hAlign]: 0,
    width: `${TOOLTIP_WIDTH}px`,
    maxWidth: `calc(100vw - ${TOOLTIP_MARGIN * 2}px)`,
    padding: '10px 12px',
    backgroundColor: '#1c1b1b',
    color: '#f6f3f2',
    fontSize: '0.6875rem',
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: '0.01em',
    textTransform: 'none',
    zIndex: 30,
    pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(28, 27, 27, 0.25)',
  };

  return (
    <span
      ref={triggerRef}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
      tabIndex={0}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'help', outline: 'none' }}
    >
      {children}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '12px',
          height: '12px',
          fontSize: '0.5rem',
          fontWeight: 700,
          color: '#7a7574',
          border: '1px solid #c4c4c4',
          borderRadius: '50%',
          lineHeight: 1,
        }}
      >
        ?
      </span>
      {open && (
        <span role="tooltip" style={tooltipStyle}>
          {label}
        </span>
      )}
    </span>
  );
}

function FamilyBadge({ family }) {
  const meta = getBaseFamilyMeta(family);
  return (
    <span
      className="inline-block px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest align-middle"
      style={{ backgroundColor: meta.color, color: '#ffffff' }}
    >
      {meta.label}
    </span>
  );
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [userDatasets, setUserDatasets] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [familyFilter, setFamilyFilter] = useState('all');

  useEffect(() => {
    setCurrentUser(getCurrentUser());
    setUserDatasets(getDatasets());
    return subscribeDatasets(setUserDatasets);
  }, []);

  // ── Dataset dropdown options, grouped by origin ────────────────────────────
  const datasetGroups = useMemo(() => {
    const sourceIds = new Set(getLeaderboardDatasets());
    const sourceOptions = SAMPLED_DATASET_FOLDERS
      .filter((d) => sourceIds.has(d.id))
      .map((d) => ({ id: d.id, label: d.name, origin: 'source' }));

    const mockCustomOptions = MOCK_CUSTOM_DATASETS.map((d) => ({
      id: d.id,
      label: d.name,
      origin: 'custom-mock',
    }));

    const userOptions = userDatasets.map((d) => ({
      id: d.id,
      label: d.name,
      origin: 'custom-user',
    }));

    return [
      { label: 'Source datasets', options: sourceOptions },
      { label: 'Engineer-curated (seeded)', options: mockCustomOptions },
      { label: 'Your curated datasets', options: userOptions },
    ].filter((g) => g.options.length > 0);
  }, [userDatasets]);

  const allOptions = useMemo(
    () => datasetGroups.flatMap((g) => g.options),
    [datasetGroups],
  );

  const [datasetId, setDatasetId] = useState(null);
  useEffect(() => {
    if (datasetId && allOptions.find((o) => o.id === datasetId)) return;
    if (allOptions.length > 0) setDatasetId(allOptions[0].id);
  }, [allOptions, datasetId]);

  const datasetMeta = useMemo(() => {
    return allOptions.find((o) => o.id === datasetId) || null;
  }, [allOptions, datasetId]);

  // Scope rows to the viewer's Access Permissions group. Admins bypass
  // scoping (they supervise every group); engineers see their own group plus
  // the baseline reference line they're trying to beat; anyone else sees
  // nothing (nav gating should prevent this, but we enforce defence-in-depth).
  const viewerAccessGroup = useMemo(() => {
    if (!currentUser) return null;
    return getAccessPermsGroupForUser(currentUser.id);
  }, [currentUser]);

  const isEngineerView = viewerAccessGroup === 'MLE-generic-access-perms';
  const isAdminView = viewerAccessGroup === 'hk-admin-access-perms';

  const rows = useMemo(() => {
    if (!datasetId) return [];
    const sourceIds = new Set(getLeaderboardDatasets());
    let all = [];
    if (sourceIds.has(datasetId)) all = getLeaderboard(datasetId);
    else if (hasCustomMockLeaderboard(datasetId)) all = getCustomMockLeaderboard(datasetId);
    else all = []; // real user-curated → no submissions yet

    let scoped;
    if (isAdminView) {
      scoped = all;
    } else if (isEngineerView) {
      scoped = all.filter((r) => {
        if (r.engineerId === 'system-baseline') return true;
        return getGroupsForUser(r.engineerId).includes(viewerAccessGroup);
      });
    } else {
      scoped = [];
    }

    if (familyFilter === 'all') return scoped;
    return scoped.filter((r) => r.baseFamily === familyFilter);
  }, [datasetId, familyFilter, viewerAccessGroup, isAdminView, isEngineerView]);

  // Family chips are derived from the already-scoped rows (ignoring the active
  // family filter so all chips stay visible once one is selected), so a family
  // with no rows in the viewer's group doesn't render as an empty chip.
  const familyOptions = useMemo(() => {
    if (!datasetId) return [];
    const sourceIds = new Set(getLeaderboardDatasets());
    let all = [];
    if (sourceIds.has(datasetId)) all = getLeaderboard(datasetId);
    else if (hasCustomMockLeaderboard(datasetId)) all = getCustomMockLeaderboard(datasetId);

    let scoped;
    if (isAdminView) {
      scoped = all;
    } else if (isEngineerView) {
      scoped = all.filter((r) => {
        if (r.engineerId === 'system-baseline') return true;
        return getGroupsForUser(r.engineerId).includes(viewerAccessGroup);
      });
    } else {
      scoped = [];
    }

    return Array.from(new Set(scoped.map((r) => r.baseFamily)));
  }, [datasetId, viewerAccessGroup, isAdminView, isEngineerView]);

  const yourRow = useMemo(() => {
    if (!currentUser || rows.length === 0) return null;
    return rows.find((r) => r.engineerId === currentUser.id) || null;
  }, [currentUser, rows]);

  const totalSubmissions = rows.reduce((acc, r) => acc + (r.submissionCount || 0), 0);
  const isUserCurated = datasetMeta?.origin === 'custom-user';

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
        <span className="uppercase tracking-widest" style={{ color: '#b20100' }}>Engineering</span>
        <span>/</span>
        <span className="uppercase tracking-widest">Leaderboard</span>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between mb-8 pb-6" style={{ borderBottom: '2px solid #1c1b1b' }}>
        <div>
          <h1 className="text-[2.5rem] font-bold leading-none tracking-tight uppercase" style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}>
            Leaderboard
          </h1>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4" style={{ color: '#7a7574' }}>
            {rows.length} Engineer{rows.length === 1 ? '' : 's'} &middot; {totalSubmissions} total submissions &middot; {
              isAdminView
                ? 'All engineering groups (admin view)'
                : isEngineerView
                  ? 'Scoped to your engineering group'
                  : 'No leaderboard access'
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574' }}>Dataset</span>
            <select
              value={datasetId || ''}
              onChange={(e) => setDatasetId(e.target.value)}
              className="px-3 py-2 text-[0.8125rem] font-medium cursor-pointer"
              style={{ backgroundColor: '#ffffff', border: '1.5px solid #1c1b1b', borderRadius: 0, color: '#1c1b1b', minWidth: '260px' }}
            >
              {datasetGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => { if (datasetId) router.push(`/datasets/${encodeURIComponent(datasetId)}?openSession=1`); }}
            disabled={!datasetId}
            className="px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: 0 }}
            title="Start an analysis session on this dataset"
          >
            + Submit Model
          </button>
        </div>
      </div>

      {/* Your Best card (no delta — dropped per design call) */}
      {yourRow ? (
        <div
          className="flex items-center justify-between p-5 mb-6"
          style={{ backgroundColor: '#ffffff', borderLeft: '4px solid #b20100' }}
        >
          <div className="flex items-center gap-6 min-w-0">
            <div>
              <p className="text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#b20100' }}>Your Best</p>
              <p className="text-[2rem] font-bold leading-none mt-1" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
                #{yourRow.rank}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[0.875rem] font-bold truncate" style={{ color: '#1c1b1b' }}>{yourRow.modelName}</p>
              <p className="text-[0.6875rem] mt-0.5" style={{ color: '#7a7574' }}>
                WER {formatPercent(yourRow.wer)} &middot; CER {formatPercent(yourRow.cer)} &middot; RTF {yourRow.rtf.toFixed(2)} &middot; {yourRow.submissionCount} submission{yourRow.submissionCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setSelectedSubmission(yourRow)}
            className="text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: '#b20100' }}
          >
            View Run &rarr;
          </button>
        </div>
      ) : (
        <div
          className="flex items-center justify-between p-5 mb-6"
          style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', borderLeft: '4px solid #7a7574' }}
        >
          <div>
            <p className="text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574' }}>
              {isUserCurated ? 'No submissions yet' : 'No submission yet'}
            </p>
            <p className="text-[0.8125rem] mt-1" style={{ color: '#1c1b1b' }}>
              {isUserCurated
                ? <>No one in your group has submitted a model for <strong>{datasetMeta?.label}</strong>. Be the first to set a baseline.</>
                : <>You haven&apos;t submitted a model for <strong>{datasetMeta?.label || datasetId}</strong>. Upload an adapter to enter the ranking.</>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (datasetId) router.push(`/datasets/${encodeURIComponent(datasetId)}?openSession=1`); }}
            disabled={!datasetId}
            className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: 0 }}
            title="Start an analysis session on this dataset"
          >
            + Submit Model
          </button>
        </div>
      )}

      {/* Family filter */}
      {familyOptions.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574' }}>Base model</span>
          <button
            onClick={() => setFamilyFilter('all')}
            className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
            style={{
              background: familyFilter === 'all' ? '#1c1b1b' : 'transparent',
              color: familyFilter === 'all' ? '#ffffff' : '#1c1b1b',
              border: `1px solid ${familyFilter === 'all' ? '#1c1b1b' : 'rgba(233, 188, 181, 0.4)'}`,
              borderRadius: 0,
            }}
          >
            All
          </button>
          {familyOptions.map((f) => {
            const active = familyFilter === f;
            const meta = getBaseFamilyMeta(f);
            return (
              <button
                key={f}
                onClick={() => setFamilyFilter(f)}
                className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                style={{
                  background: active ? meta.color : 'transparent',
                  color: active ? '#ffffff' : '#1c1b1b',
                  border: `1px solid ${active ? meta.color : 'rgba(233, 188, 181, 0.4)'}`,
                  borderRadius: 0,
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Leaderboard table */}
      <div style={{ backgroundColor: '#ffffff' }}>
        <div
          className="flex items-center px-5 py-3 text-[0.5625rem] font-semibold uppercase tracking-widest"
          style={{ color: '#7a7574', borderBottom: '1px solid rgba(233, 188, 181, 0.3)' }}
        >
          <div style={{ width: '36px' }}>#</div>
          <div className="flex-1">
            <Tooltip label={HEADER_TOOLTIPS.engineer}>Engineer</Tooltip>
          </div>
          <div className="flex-1">
            <Tooltip label={HEADER_TOOLTIPS.model}>Model</Tooltip>
          </div>
          <div className="text-right" style={{ width: '88px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Tooltip label={HEADER_TOOLTIPS.wer}>WER ↓</Tooltip>
            </span>
          </div>
          <div className="text-right" style={{ width: '72px' }}>
            <Tooltip label={HEADER_TOOLTIPS.cer}>CER</Tooltip>
          </div>
          <div className="text-right" style={{ width: '72px' }}>
            <Tooltip label={HEADER_TOOLTIPS.rtf}>RTF</Tooltip>
          </div>
          <div className="text-right" style={{ width: '96px' }}>
            <Tooltip label={HEADER_TOOLTIPS.last}>Last run</Tooltip>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center">
            {!isEngineerView && !isAdminView ? (
              <>
                <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>
                  The leaderboard is scoped to the engineering group.
                </p>
                <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                  Your account isn&apos;t a member of <strong>MLE · Generic Access Permissions</strong>, so no submissions are visible here.
                </p>
              </>
            ) : (
              <>
                <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>
                  No submissions on <strong>{datasetMeta?.label || 'this dataset'}</strong> yet.
                </p>
                <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                  {isUserCurated
                    ? 'This dataset was curated by your group but no one has submitted a model against it yet.'
                    : 'Be the first — submit a model to claim rank 1.'}
                </p>
              </>
            )}
          </div>
        ) : (
          rows.map((row) => {
            const isYou = currentUser && row.engineerId === currentUser.id;
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSubmission(row)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSubmission(row); } }}
                className="flex items-center px-5 py-4 cursor-pointer transition-colors"
                style={{
                  backgroundColor: isYou ? 'rgba(178, 1, 0, 0.05)' : 'transparent',
                  borderBottom: '1px solid rgba(233, 188, 181, 0.15)',
                  borderLeft: isYou ? '3px solid #b20100' : '3px solid transparent',
                }}
                onMouseEnter={(e) => { if (!isYou) e.currentTarget.style.backgroundColor = '#f6f3f2'; }}
                onMouseLeave={(e) => { if (!isYou) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="text-[0.875rem] font-bold flex items-center gap-1.5" style={{ width: '36px', color: '#1c1b1b' }}>
                  {row.rank}
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-[0.8125rem] font-bold truncate" style={{ color: '#1c1b1b' }}>
                    {row.engineerName}
                    {isYou && (
                      <span
                        className="ml-2 px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest align-middle"
                        style={{ backgroundColor: '#b20100', color: '#ffffff' }}
                      >
                        You
                      </span>
                    )}
                  </p>
                  <p className="text-[0.625rem]" style={{ color: '#7a7574' }}>
                    {row.submissionCount} submission{row.submissionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-[0.75rem] truncate" style={{ color: '#1c1b1b' }}>{row.modelName}</p>
                  <div className="mt-1"><FamilyBadge family={row.baseFamily} /></div>
                </div>
                <div className="text-right text-[0.875rem] font-bold" style={{ width: '88px', color: '#1c1b1b', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(row.wer)}
                </div>
                <div className="text-right text-[0.75rem]" style={{ width: '72px', color: '#7a7574', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(row.cer)}
                </div>
                <div className="text-right text-[0.75rem]" style={{ width: '72px', color: '#7a7574', fontVariantNumeric: 'tabular-nums' }}>
                  {row.rtf.toFixed(2)}
                </div>
                <div
                  className="text-right text-[0.6875rem]"
                  style={{ width: '96px', color: '#7a7574' }}
                  title={formatAbsolute(row.submittedAt)}
                >
                  {formatRelative(row.submittedAt)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer audit strip */}
      <div className="flex items-center justify-between mt-8 pt-4 text-[0.5625rem] uppercase tracking-widest" style={{ color: '#7a7574', borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
        <span>Ranking: lower WER beats higher WER</span>
        <span>Scoped to your engineering group · mock data</span>
        <span>Evaluation split frozen at provisioning time</span>
      </div>

      <SubmissionDrawer submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} />
    </div>
  );
}
