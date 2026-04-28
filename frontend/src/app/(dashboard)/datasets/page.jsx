'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SAMPLED_DATASET_FILES, SAMPLED_DATASET_FOLDERS } from '@/services/sampled-datasets';
import { createDataset, getDatasets, subscribeDatasets } from '@/services/datasets';
import OwnerBadge from '../components/OwnerBadge';
import { SOURCE_DATASET_META } from '@/services/mock_data-dataset';

function parseDuration(mmss) {
  if (typeof mmss !== 'string') return 0;
  const [m, s] = mmss.split(':').map(Number);
  if (Number.isNaN(m) || Number.isNaN(s)) return 0;
  return m * 60 + s;
}

function formatHours(totalSeconds) {
  const hours = totalSeconds / 3600;
  if (hours < 1) {
    const minutes = Math.round(totalSeconds / 60);
    return `${minutes} min`;
  }
  return `${hours.toFixed(1)} hrs`;
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatCard({ label, value, sublabel, accent }) {
  return (
    <div
      className="p-5"
      style={{
        backgroundColor: '#ffffff',
        border: '2px solid transparent',
        borderRadius: '0px',
      }}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: '#7a7574' }}>{label}</p>
      <p className="text-[2rem] font-bold" style={{ color: accent ? '#b20100' : '#1c1b1b', letterSpacing: '-0.02em' }}>{value}</p>
      {sublabel && <p className="text-[0.6875rem] mt-1" style={{ color: '#7a7574' }}>{sublabel}</p>}
    </div>
  );
}

function Tag({ children }) {
  return (
    <span
      className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: '#f6f3f2', color: '#1c1b1b' }}
    >
      {children}
    </span>
  );
}

function SourceDatasetCard({ dataset }) {
  const meta = SOURCE_DATASET_META[dataset.id] || {};
  return (
    <div className="p-6 flex flex-col gap-4" style={{ backgroundColor: '#ffffff' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#b20100' }}>
            {meta.purpose || 'Source Dataset'}
          </p>
          <h3 className="text-[1rem] font-bold tracking-tight break-words" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
            <Link
              href={`/datasets/${dataset.id}`}
              className="no-underline hover:underline"
              style={{ color: 'inherit', textDecorationColor: '#b20100', textUnderlineOffset: '3px' }}
            >
              {dataset.name}
            </Link>
          </h3>
          <p className="text-[0.6875rem] mt-1" style={{ color: '#7a7574' }}>{meta.origin || 'External source'}</p>
        </div>
        <span className="shrink-0 px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ backgroundColor: '#1c1b1b', color: '#ffffff' }}>
          {meta.status || 'Active'}
        </span>
      </div>

      {meta.description && (
        <p className="text-[0.8125rem] leading-relaxed" style={{ color: '#1c1b1b' }}>{meta.description}</p>
      )}

      <div className="grid grid-cols-3 gap-4 pt-3" style={{ borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
        <div>
          <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>Files</p>
          <p className="text-[1rem] font-bold" style={{ color: '#1c1b1b' }}>{dataset.fileCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>Audio</p>
          <p className="text-[1rem] font-bold" style={{ color: '#1c1b1b' }}>{dataset.audioLabel}</p>
        </div>
        <div>
          <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>Languages</p>
          <p className="text-[1rem] font-bold" style={{ color: '#1c1b1b' }}>{(meta.languages || []).length || '\u2014'}</p>
        </div>
      </div>

      {meta.tags && meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.tags.map((t) => <Tag key={t}>{t}</Tag>)}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-4">
        <Link
          href={`/datasets/${dataset.id}`}
          className="text-[0.625rem] font-semibold uppercase tracking-widest no-underline"
          style={{ color: '#b20100' }}
        >
          View Dataset &rarr;
        </Link>
        <span className="text-[0.5625rem] font-mono uppercase tracking-widest" style={{ color: '#7a7574' }}>
          {dataset.id.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

export default function DatasetsPage() {
  const [customDatasets, setCustomDatasets] = useState([]);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [engineerOpen, setEngineerOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [intersectionOpen, setIntersectionOpen] = useState(false);
  const [mergeDraft, setMergeDraft] = useState(null);
  const [mergeError, setMergeError] = useState('');

  useEffect(() => {
    setCustomDatasets(getDatasets());
    return subscribeDatasets(setCustomDatasets);
  }, []);

  useEffect(() => {
    setSelectedIds((prev) => {
      const existing = new Set(customDatasets.map((d) => d.id));
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (existing.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [customDatasets]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setIntersectionOpen(false);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIntersectionOpen(false);
  };

  const selectedDatasets = useMemo(
    () => customDatasets.filter((d) => selectedIds.has(d.id)),
    [customDatasets, selectedIds],
  );

  const intersection = useMemo(() => {
    if (selectedDatasets.length < 2) return [];
    const [first, ...rest] = selectedDatasets;
    const firstIds = first.fileIds || [];
    return firstIds.filter((fid) => rest.every((ds) => (ds.fileIds || []).includes(fid)));
  }, [selectedDatasets]);

  const union = useMemo(() => {
    const s = new Set();
    selectedDatasets.forEach((d) => (d.fileIds || []).forEach((fid) => s.add(fid)));
    return [...s];
  }, [selectedDatasets]);

  const fileMap = useMemo(() => {
    const m = new Map();
    SAMPLED_DATASET_FILES.forEach((f) => m.set(f.id, f));
    return m;
  }, []);

  const handleMerge = () => {
    const name = mergeDraft?.name?.trim();
    if (!name) {
      setMergeError('Name is required.');
      return;
    }
    if (selectedDatasets.length < 2) {
      setMergeError('Select at least two datasets to merge.');
      return;
    }
    const description =
      mergeDraft.description?.trim() ||
      `Merged from ${selectedDatasets.map((d) => d.name).join(' + ')}`;
    createDataset({
      name,
      description,
      fileIds: union,
      tags: ['merged'],
      createdBy: 'Engineer User',
    });
    setMergeDraft(null);
    setMergeError('');
    clearSelection();
  };

  const enrichedSources = useMemo(() => {
    return SAMPLED_DATASET_FOLDERS.map((d) => {
      const files = SAMPLED_DATASET_FILES.filter((f) => f.dataset === d.id);
      const seconds = files.reduce((acc, f) => acc + parseDuration(f.duration), 0);
      return { ...d, audioSeconds: seconds, audioLabel: seconds > 0 ? formatHours(seconds) : '\u2014' };
    });
  }, []);

  const totals = useMemo(() => {
    const totalFiles = enrichedSources.reduce((acc, d) => acc + d.fileCount, 0)
      + customDatasets.reduce((acc, d) => acc + (d.fileIds?.length || 0), 0);
    const totalSeconds = enrichedSources.reduce((acc, d) => acc + d.audioSeconds, 0);
    const languages = new Set();
    enrichedSources.forEach((d) => (SOURCE_DATASET_META[d.id]?.languages || []).forEach((l) => languages.add(l)));
    return {
      datasetCount: enrichedSources.length + customDatasets.length,
      totalFiles,
      audioHours: formatHours(totalSeconds),
      languageCount: languages.size,
    };
  }, [enrichedSources, customDatasets]);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
        <span className="uppercase tracking-widest" style={{ color: '#b20100' }}>Engineering</span>
        <span>/</span>
        <span className="uppercase tracking-widest">Data Catalogue</span>
      </div>

      {/* Editorial header */}
      <div className="flex items-end justify-between mb-10 pb-6" style={{ borderBottom: '2px solid #1c1b1b' }}>
        <div>
          <h1 className="text-[2.75rem] font-bold leading-none tracking-tight uppercase" style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}>
            Datasets
          </h1>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4" style={{ color: '#7a7574' }}>
            {enrichedSources.length} Source Sets &middot; {customDatasets.length} Engineer Sets &middot; Catalogue synchronised with sampled_datasets/
          </p>
        </div>
        <div className="flex gap-3">
          <button className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer" style={{ backgroundColor: 'transparent', border: '1.5px solid #1c1b1b', borderRadius: '0px', color: '#1c1b1b' }}>
            Export Manifest
          </button>
          <Link href="/files" className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer no-underline" style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}>
            Curate New Set &rarr;
          </Link>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        <StatCard label="Total Datasets" value={totals.datasetCount} sublabel={`${enrichedSources.length} source + ${customDatasets.length} custom`} />
        <StatCard label="Total Files" value={totals.totalFiles.toLocaleString()} sublabel="Across all datasets" />
        <StatCard label="Audio Hours" value={totals.audioHours} sublabel="Sampled sources only" />
        <StatCard label="Languages" value={totals.languageCount} sublabel="Covered by source sets" accent />
      </div>

      {/* Engineer datasets */}
      <div className="mb-10">
        <button
          type="button"
          onClick={() => setEngineerOpen((v) => !v)}
          className="w-full flex items-center justify-between mb-5 cursor-pointer"
          style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left' }}
          aria-expanded={engineerOpen}
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center text-[0.75rem] font-bold"
              style={{
                width: '1.25rem',
                height: '1.25rem',
                color: '#1c1b1b',
                transform: engineerOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
              aria-hidden
            >
              &rsaquo;
            </span>
            <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
              Engineer Datasets
              <span className="ml-3 text-[0.6875rem] font-semibold" style={{ color: '#7a7574' }}>
                ({customDatasets.length})
              </span>
            </h2>
          </div>
          <span className="text-[0.6875rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
            Curated via the file browser · stored locally
          </span>
        </button>

        {engineerOpen && (
          customDatasets.length === 0 ? (
            <div className="p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
              <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>No engineer datasets yet.</p>
              <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                Curate files from the <Link href="/files" style={{ color: '#b20100', textDecoration: 'none' }}>file browser</Link> into a named set to make it reusable across training jobs.
              </p>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="flex items-center justify-between px-5 py-3 mb-3" style={{ backgroundColor: '#1c1b1b', color: '#ffffff' }}>
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-[0.75rem] font-bold uppercase tracking-widest shrink-0">
                      {selectedIds.size} Selected
                    </span>
                    <span className="text-[0.625rem] uppercase tracking-widest truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {selectedIds.size < 2
                        ? 'Pick one more to compare or merge'
                        : `${intersection.length.toLocaleString()} shared \u00b7 ${union.length.toLocaleString()} combined`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIntersectionOpen((v) => !v)}
                      disabled={selectedIds.size < 2}
                      className="px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: '0px', color: '#ffffff' }}
                    >
                      {intersectionOpen ? 'Hide Intersection' : 'View Intersection'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMergeError('');
                        setMergeDraft({ name: '', description: '' });
                      }}
                      disabled={selectedIds.size < 2}
                      className="px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                    >
                      Merge &rarr;
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                      style={{ backgroundColor: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)' }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {intersectionOpen && selectedIds.size >= 2 && (
                <div className="mb-3" style={{ backgroundColor: '#ffffff', border: '2px solid #b20100' }}>
                  <div className="flex items-start justify-between px-5 py-3 gap-4" style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.25)' }}>
                    <div className="min-w-0">
                      <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#b20100' }}>Intersection</p>
                      <p className="text-[0.875rem] font-bold" style={{ color: '#1c1b1b' }}>
                        {intersection.length.toLocaleString()} recording{intersection.length === 1 ? '' : 's'} shared across all {selectedDatasets.length} sets
                      </p>
                    </div>
                    <p className="text-[0.625rem] uppercase tracking-widest text-right" style={{ color: '#7a7574' }}>
                      {selectedDatasets.map((d) => d.name).join(' \u2229 ')}
                    </p>
                  </div>
                  {intersection.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-[0.8125rem]" style={{ color: '#7a7574' }}>
                        No recordings appear in every selected dataset.
                      </p>
                    </div>
                  ) : (
                    <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                      <div className="flex items-center px-5 py-2 text-[0.5625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574', borderBottom: '1px solid rgba(233, 188, 181, 0.15)' }}>
                        <div className="flex-1">Recording</div>
                        <div className="w-32">Language</div>
                        <div className="w-20 text-right">Duration</div>
                      </div>
                      {intersection.map((fid) => {
                        const f = fileMap.get(fid);
                        return (
                          <div key={fid} className="flex items-center px-5 py-2 text-[0.75rem]" style={{ borderBottom: '1px solid rgba(233, 188, 181, 0.08)' }}>
                            <div className="flex-1 min-w-0 truncate pr-3" style={{ color: '#1c1b1b' }}>
                              {f?.name || <span className="font-mono text-[0.6875rem]" style={{ color: '#7a7574' }}>{fid}</span>}
                            </div>
                            <div className="w-32 truncate" style={{ color: '#7a7574' }}>{f?.detectedLanguage || '\u2014'}</div>
                            <div className="w-20 text-right font-mono text-[0.6875rem]" style={{ color: '#7a7574' }}>{f?.duration || '\u2014'}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-center px-6 py-4 text-[0.625rem] font-semibold uppercase tracking-widest" style={{ color: '#7a7574', borderBottom: '1px solid rgba(233, 188, 181, 0.2)' }}>
                  <div className="w-10" />
                  <div className="flex-1">Dataset</div>
                  <div className="w-32">Files</div>
                  <div className="w-40">Created By</div>
                  <div className="w-40">Created</div>
                  <div className="w-24" />
                </div>
                {customDatasets.map((d) => {
                  const selected = selectedIds.has(d.id);
                  return (
                    <div
                      key={d.id}
                      className="flex items-center px-6 py-5"
                      style={{
                        borderBottom: '1px solid rgba(233, 188, 181, 0.08)',
                        backgroundColor: selected ? 'rgba(178, 1, 0, 0.04)' : 'transparent',
                        boxShadow: selected ? 'inset 3px 0 0 0 #b20100' : 'none',
                      }}
                    >
                      <div className="w-10 flex items-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSelect(d.id)}
                          aria-label={`Select ${d.name}`}
                          style={{ accentColor: '#b20100', cursor: 'pointer', width: '1rem', height: '1rem' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                          <Link
                            href={`/datasets/${d.id}`}
                            className="no-underline hover:underline"
                            style={{ color: 'inherit', textDecorationColor: '#b20100', textUnderlineOffset: '3px' }}
                          >
                            {d.name}
                          </Link>
                        </p>
                        {d.description && (
                          <p className="text-[0.6875rem] mt-0.5 truncate" style={{ color: '#7a7574' }}>{d.description}</p>
                        )}
                        {d.tags && d.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {d.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                          </div>
                        )}
                      </div>
                      <div className="w-32 text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                        {(d.fileIds?.length || 0).toLocaleString()}
                      </div>
                      <div className="w-40">
                        <OwnerBadge owner={d.createdBy} size="sm" />
                      </div>
                      <div className="w-40 text-[0.75rem]" style={{ color: '#7a7574' }}>{formatDate(d.createdAt)}</div>
                      <div className="w-24 text-right">
                        <Link
                          href={`/datasets/${d.id}`}
                          className="text-[0.625rem] font-semibold uppercase tracking-widest no-underline"
                          style={{ color: '#b20100' }}
                        >
                          Open &rarr;
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )
        )}
      </div>

      {/* Source datasets */}
      <div>
        <button
          type="button"
          onClick={() => setSourceOpen((v) => !v)}
          className="w-full flex items-center justify-between mb-5 cursor-pointer"
          style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left' }}
          aria-expanded={sourceOpen}
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center text-[0.75rem] font-bold"
              style={{
                width: '1.25rem',
                height: '1.25rem',
                color: '#1c1b1b',
                transform: sourceOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
              aria-hidden
            >
              &rsaquo;
            </span>
            <h2 className="text-[0.875rem] font-bold uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
              Source Datasets
              <span className="ml-3 text-[0.6875rem] font-semibold" style={{ color: '#7a7574' }}>
                ({enrichedSources.length})
              </span>
            </h2>
          </div>
          <span className="text-[0.6875rem] uppercase tracking-widest" style={{ color: '#7a7574' }}>
            Read-only · provisioned via data_collection/init.py
          </span>
        </button>
        {sourceOpen && (
          <div className="grid grid-cols-2 gap-4">
            {enrichedSources.map((d) => <SourceDatasetCard key={d.id} dataset={d} />)}
          </div>
        )}
      </div>

      {/* Footer audit strip */}
      <div className="flex items-center justify-between mt-10 pt-4 text-[0.625rem] uppercase tracking-widest" style={{ color: '#7a7574', borderTop: '1px solid rgba(233, 188, 181, 0.2)' }}>
        <span>Provisioning: data_collection/init.py</span>
        <span>Compliance Hash: DS-L74-9 Verified</span>
        <span>Storage: On-Premise Enclave</span>
      </div>

      {mergeDraft && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ backgroundColor: 'rgba(28, 27, 27, 0.55)' }}
          onClick={() => { setMergeDraft(null); setMergeError(''); }}
        >
          <div
            className="p-6"
            style={{ backgroundColor: '#ffffff', width: '520px', maxWidth: '100%', borderTop: '3px solid #b20100' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#b20100' }}>Merge Engineer Sets</p>
            <h3 className="text-[1.25rem] font-bold tracking-tight mb-1" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
              Combine {selectedDatasets.length} datasets
            </h3>
            <p className="text-[0.6875rem] mb-5 truncate" style={{ color: '#7a7574' }}>
              {selectedDatasets.map((d) => d.name).join(' + ')}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3" style={{ backgroundColor: '#f6f3f2' }}>
                <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>Recordings in new set</p>
                <p className="text-[1.5rem] font-bold" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>{union.length.toLocaleString()}</p>
                <p className="text-[0.5625rem] mt-0.5" style={{ color: '#7a7574' }}>Union, duplicates collapsed</p>
              </div>
              <div className="p-3" style={{ backgroundColor: '#f6f3f2' }}>
                <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#7a7574' }}>Shared across all sets</p>
                <p className="text-[1.5rem] font-bold" style={{ color: '#b20100', letterSpacing: '-0.02em' }}>{intersection.length.toLocaleString()}</p>
                <p className="text-[0.5625rem] mt-0.5" style={{ color: '#7a7574' }}>Intersection count</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[0.625rem] font-semibold uppercase tracking-widest block mb-1" style={{ color: '#7a7574' }}>Name</label>
              <input
                type="text"
                value={mergeDraft.name}
                onChange={(e) => setMergeDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Cantonese fine-tune (merged)"
                className="w-full px-3 py-2 text-[0.875rem]"
                style={{ backgroundColor: '#f6f3f2', border: 'none', borderBottom: '2px solid #c4c4c4', borderRadius: '0px', color: '#1c1b1b' }}
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="text-[0.625rem] font-semibold uppercase tracking-widest block mb-1" style={{ color: '#7a7574' }}>Description (optional)</label>
              <textarea
                value={mergeDraft.description}
                onChange={(e) => setMergeDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-[0.8125rem]"
                style={{ backgroundColor: '#f6f3f2', border: 'none', borderBottom: '2px solid #c4c4c4', borderRadius: '0px', color: '#1c1b1b', resize: 'vertical' }}
              />
            </div>

            {mergeError && (
              <p className="text-[0.75rem] mb-3" style={{ color: '#b20100' }}>{mergeError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setMergeDraft(null); setMergeError(''); }}
                className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(28,27,27,0.2)', borderRadius: '0px', color: '#1c1b1b' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={!mergeDraft.name?.trim()}
                className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
              >
                Create Merged Set &rarr;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
