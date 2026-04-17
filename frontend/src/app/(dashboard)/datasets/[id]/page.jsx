'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
    SAMPLED_DATASET_FILES,
    SAMPLED_DATASET_FOLDERS,
    ROOT_LEVEL_SAMPLED_FILES,
} from '@/services/sampled-datasets';
import { SOURCE_DATASET_META } from '@/services/mock_data-dataset';
import { getDatasetById, subscribeDatasets, updateDatasetUnseen } from '@/services/datasets';
import { getCurrentUser } from '@/services/api';
import { users } from '@/services/mock_data-users';
import { getTrainingJobs } from '@/services/training-jobs';
import OwnerBadge from '../../components/OwnerBadge';

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
    return d
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase();
}

function StatusBadge({ status }) {
    const styles = {
        'needs action': { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'NEEDS ACTION' },
        'in review': { bg: 'rgba(0, 78, 198, 0.08)', color: '#004ec6', label: 'IN REVIEW' },
        transcribing: { bg: 'rgba(122, 117, 116, 0.1)', color: '#7a7574', label: 'TRANSCRIBING' },
        completed: { bg: 'rgba(26, 127, 55, 0.08)', color: '#1a7f37', label: 'COMPLETED' },
        transcribed: { bg: 'rgba(158, 106, 0, 0.08)', color: '#9e6a00', label: 'TRANSCRIBED' },
    };
    const s = styles[status] || styles['needs action'];
    return (
        <span
            className="inline-block px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: s.bg, color: s.color }}
        >
            {s.label}
        </span>
    );
}

function StatCard({ label, value, sublabel, accent }) {
    return (
        <div className="p-8" style={{ backgroundColor: '#ffffff' }}>
            <p
                className="text-[0.625rem] font-semibold uppercase tracking-widest mb-6"
                style={{ color: '#7a7574' }}
            >
                {label}
            </p>
            <p
                className="text-[2.5rem] font-bold leading-none tracking-tight"
                style={{
                    color: accent ? '#b20100' : '#1c1b1b',
                    letterSpacing: '-0.02em',
                }}
            >
                {value}
            </p>
            {sublabel && (
                <p className="text-[0.6875rem] mt-3" style={{ color: '#7a7574' }}>
                    {sublabel}
                </p>
            )}
            <div
                className="mt-6 w-full h-px"
                style={{ backgroundColor: accent ? '#b20100' : '#1c1b1b' }}
            />
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

function FileIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a7574" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}

// Resolves where a recording "lives" in the file browser. Files carrying a
// `dataset` field are scoped to that source folder; everything else is a
// root-level upload (earnings22, spgispeech, multispeak).
function resolveFileLocation(file) {
    if (file.dataset) {
        const folder = SAMPLED_DATASET_FOLDERS.find((f) => f.id === file.dataset);
        return {
            label: folder ? folder.source : file.dataset,
            href: `/files/${file.id}`,
        };
    }
    return {
        label: 'HOME / ROOT',
        href: `/files/${file.id}`,
    };
}

function LocationLink({ file }) {
    const loc = resolveFileLocation(file);
    return (
        <Link
            href={loc.href}
            onClick={(e) => e.stopPropagation()}
            className="group inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-widest no-underline"
            style={{ color: '#b20100' }}
            title={`Open recording at ${loc.label} in the file browser`}
        >
            <span
                className="truncate"
                style={{ maxWidth: '10rem' }}
            >
                {loc.label}
            </span>
            <span aria-hidden>&rarr;</span>
        </Link>
    );
}

function NotFound({ id, router }) {
    return (
        <div>
            <div className="flex items-center gap-2 text-[0.6875rem] mb-2" style={{ color: '#7a7574' }}>
                <Link
                    href="/datasets"
                    className="uppercase tracking-widest no-underline"
                    style={{ color: '#b20100' }}
                >
                    Datasets
                </Link>
                <span>/</span>
                <span className="uppercase tracking-widest">Not Found</span>
            </div>
            <div
                className="flex items-end justify-between mb-10 pb-6"
                style={{ borderBottom: '2px solid #1c1b1b' }}
            >
                <div>
                    <h1
                        className="text-[2.75rem] font-bold leading-none tracking-tight uppercase"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                    >
                        Dataset Not Found
                    </h1>
                    <p
                        className="text-[0.6875rem] font-semibold uppercase tracking-widest mt-4"
                        style={{ color: '#7a7574' }}
                    >
                        No dataset with id {id || '\u2014'} in the catalogue
                    </p>
                </div>
                <button
                    onClick={() => router.push('/datasets')}
                    className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                    style={{
                        backgroundColor: 'transparent',
                        border: '1.5px solid #1c1b1b',
                        borderRadius: '0px',
                        color: '#1c1b1b',
                    }}
                >
                    &larr; Back to Catalogue
                </button>
            </div>
        </div>
    );
}

export default function DatasetDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const datasetId = params?.id;

    const [customDataset, setCustomDataset] = useState(null);
    const [customLoaded, setCustomLoaded] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [exportTarget, setExportTarget] = useState('vm');
    const [exportPhase, setExportPhase] = useState('select');
    const [exportLog, setExportLog] = useState([]);
    const [trainingJobs, setTrainingJobs] = useState([]);
    const [exportModelId, setExportModelId] = useState('');

    useEffect(() => {
        const jobs = getTrainingJobs();
        setTrainingJobs(jobs);
        setExportModelId((prev) => prev || jobs[0]?.id || '');
    }, []);

    // Resolve engineer-created datasets (localStorage-backed).
    useEffect(() => {
        const refresh = () => {
            setCustomDataset(getDatasetById(datasetId));
            setCustomLoaded(true);
        };
        refresh();
        return subscribeDatasets(refresh);
    }, [datasetId]);

    // Current user drives the hold-out editability check — only the dataset
    // creator can mark files as unseen.
    useEffect(() => {
        setCurrentUser(getCurrentUser() || null);
    }, []);

    // Resolve source dataset (static). Memoised so downstream memos are stable.
    const sourceDataset = useMemo(
        () => SAMPLED_DATASET_FOLDERS.find((d) => d.id === datasetId) || null,
        [datasetId],
    );

    const isSource = Boolean(sourceDataset);
    const isCustom = Boolean(customDataset);

    // Build the file list for whichever kind of dataset this is. Engineer
    // datasets can contain files from either the per-dataset pool
    // (SAMPLED_DATASET_FILES) or the root-level pool (earnings22, spgispeech,
    // multispeak), so search both.
    const files = useMemo(() => {
        if (isSource) {
            return SAMPLED_DATASET_FILES.filter((f) => f.dataset === datasetId);
        }
        if (isCustom) {
            const ids = new Set(customDataset.fileIds || []);
            const pool = [...SAMPLED_DATASET_FILES, ...ROOT_LEVEL_SAMPLED_FILES];
            // Preserve the engineer's original selection order.
            const byId = new Map(pool.filter((f) => ids.has(f.id)).map((f) => [f.id, f]));
            return (customDataset.fileIds || [])
                .map((fid) => byId.get(fid))
                .filter(Boolean);
        }
        return [];
    }, [isSource, isCustom, customDataset, datasetId]);

    const stats = useMemo(() => {
        const totalSeconds = files.reduce((acc, f) => acc + parseDuration(f.duration), 0);
        const langSet = new Set(files.map((f) => f.detectedLanguage).filter(Boolean));
        const speakerCount = files.reduce((acc, f) => acc + (f.speakerDetection || 0), 0);
        const werValues = files
            .map((f) => f.wer)
            .filter((v) => typeof v === 'number' && !Number.isNaN(v));
        const avgWer = werValues.length
            ? Math.round((werValues.reduce((a, b) => a + b, 0) / werValues.length) * 10) / 10
            : null;
        return {
            fileCount: files.length,
            audioLabel: totalSeconds > 0 ? formatHours(totalSeconds) : '\u2014',
            languageCount: langSet.size,
            avgSpeakers: files.length ? (speakerCount / files.length).toFixed(1) : '\u2014',
            avgWer,
        };
    }, [files]);

    useEffect(() => {
        if (exportPhase !== 'running') return;
        const count = stats.fileCount.toLocaleString();
        const envStep = exportTarget === 'vm'
            ? 'Provisioning remote compute node (4 vCPU \u00b7 16 GB \u00b7 T4)...'
            : 'Binding local docker daemon & mounting workspace...';
        const selectedJob = trainingJobs.find((j) => j.id === exportModelId);
        const modelLabel = selectedJob
            ? `${selectedJob.baseModel} (job ${selectedJob.id})`
            : 'base model';
        const steps = [
            'Authenticating with austin.registry.cloud...',
            `Resolving dataset manifest (${count} recordings, ${stats.audioLabel})...`,
            `Checking out model weights: ${modelLabel}...`,
            'Pulling docker image austin/engineer-eda:latest (authorized EDA toolchain)...',
            envStep,
            'Routing to external machine...',
        ];
        let cancelled = false;
        let i = 0;
        const run = () => {
            if (cancelled) return;
            if (i >= steps.length) {
                setExportPhase('done');
                return;
            }
            setExportLog((prev) => [...prev, steps[i]]);
            i += 1;
            setTimeout(run, 850);
        };
        const kick = setTimeout(run, 250);
        return () => { cancelled = true; clearTimeout(kick); };
    }, [exportPhase, exportTarget, exportModelId, trainingJobs, stats.fileCount, stats.audioLabel]);

    const openExport = () => {
        setExportTarget('vm');
        setExportPhase('select');
        setExportLog([]);
        setExportModelId((prev) => prev || trainingJobs[0]?.id || '');
        setExportOpen(true);
    };

    // Auto-open the analysis-session dialog when the page is entered with
    // ?openSession=1 (used by the leaderboard's Submit Model CTA). Strip the
    // flag after opening so closing + reopening this route doesn't re-trigger.
    useEffect(() => {
        if (!searchParams || searchParams.get('openSession') !== '1') return;
        openExport();
        const next = new URLSearchParams(searchParams.toString());
        next.delete('openSession');
        const qs = next.toString();
        router.replace(qs ? `/datasets/${datasetId}?${qs}` : `/datasets/${datasetId}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, datasetId]);
    const closeExport = () => setExportOpen(false);
    const startExport = () => {
        setExportLog([]);
        setExportPhase('running');
    };

    // Wait for localStorage check before deciding "not found".
    if (!customLoaded) return null;
    if (!isSource && !isCustom) return <NotFound id={datasetId} router={router} />;

    const meta = isSource ? SOURCE_DATASET_META[datasetId] || {} : {};
    const displayName = isSource ? sourceDataset.name : customDataset.name;
    const purposeLabel = isSource
        ? meta.purpose || 'Source Dataset'
        : 'Engineer Curated Set';
    const originText = isSource ? meta.origin || 'External source' : null;
    const descriptionText = isSource ? meta.description : customDataset.description;
    const tags = isSource ? meta.tags || [] : customDataset.tags || [];
    const statusLabel = isSource ? meta.status || 'Active' : 'Curated';

    // Only the dataset creator can toggle hold-out membership. createdBy may
    // be a user id (e.g. "u2") or a full name (e.g. "Engineer User"), so
    // accept either format.
    const canEdit = (() => {
        if (!isCustom || !currentUser) return false;
        const owner = customDataset.createdBy;
        if (!owner) return false;
        if (owner === currentUser.id) return true;
        if (owner === currentUser.name) return true;
        const u = users.find((x) => x.name === owner);
        return u?.id === currentUser.id;
    })();
    const unseenSet = new Set(isCustom ? customDataset.unseenFileIds || [] : []);
    const unseenCount = unseenSet.size;

    const toggleUnseen = (fileId) => {
        if (!canEdit) return;
        const next = new Set(unseenSet);
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        updateDatasetUnseen(datasetId, [...next]);
    };

    const toggleAllUnseen = () => {
        if (!canEdit) return;
        const allIds = files.map((f) => f.id);
        const allMarked = allIds.every((fid) => unseenSet.has(fid));
        updateDatasetUnseen(datasetId, allMarked ? [] : allIds);
    };
    const allUnseen = files.length > 0 && files.every((f) => unseenSet.has(f.id));

    return (
        <div>
            {/* Breadcrumb */}
            <div
                className="flex items-center gap-2 text-[0.6875rem] mb-2"
                style={{ color: '#7a7574' }}
            >
                <Link
                    href="/datasets"
                    className="uppercase tracking-widest no-underline"
                    style={{ color: '#b20100' }}
                >
                    Datasets
                </Link>
                <span>/</span>
                <span className="uppercase tracking-widest" style={{ color: '#1c1b1b' }}>
                    {isSource ? 'Source Set' : 'Engineer Set'}
                </span>
                <span>/</span>
                <span
                    className="uppercase tracking-widest truncate"
                    style={{ color: '#1c1b1b', maxWidth: '40ch' }}
                    title={displayName}
                >
                    {displayName}
                </span>
            </div>

            {/* Editorial header */}
            <div
                className="flex items-end justify-between gap-6 mb-10 pb-6"
                style={{ borderBottom: '2px solid #1c1b1b' }}
            >
                <div className="min-w-0">
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-3"
                        style={{ color: '#b20100' }}
                    >
                        {purposeLabel}
                    </p>
                    <h1
                        className="text-[2.75rem] font-bold leading-none tracking-tight uppercase break-words"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.03em' }}
                    >
                        {displayName}
                    </h1>
                    <div
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-semibold uppercase tracking-widest mt-4"
                        style={{ color: '#7a7574' }}
                    >
                        {isSource ? (
                            <span>{originText}</span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <span>Curated by</span>
                                <OwnerBadge owner={customDataset.createdBy} size="xs" />
                            </span>
                        )}
                        <span>&middot;</span>
                        <span>{stats.fileCount.toLocaleString()} Recordings</span>
                        <span>&middot;</span>
                        <span>Synchronised with sampled_datasets/</span>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <span
                        className="px-2 py-1 text-[0.5625rem] font-semibold uppercase tracking-widest"
                        style={{ backgroundColor: '#1c1b1b', color: '#ffffff' }}
                    >
                        {statusLabel}
                    </span>
                    <button
                        onClick={() => router.push('/datasets')}
                        className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #1c1b1b',
                            borderRadius: '0px',
                            color: '#1c1b1b',
                        }}
                    >
                        &larr; Catalogue
                    </button>
                    <button
                        type="button"
                        onClick={openExport}
                        className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer"
                        style={{
                            backgroundColor: 'transparent',
                            border: '1.5px solid #b20100',
                            borderRadius: '0px',
                            color: '#b20100',
                        }}
                    >
                        Export Dataset &rarr;
                    </button>
                    <Link
                        href={`/files?dataset=${datasetId}`}
                        className="px-6 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer no-underline"
                        style={{
                            background: 'linear-gradient(135deg, #b20100, #e10000)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '0px',
                        }}
                    >
                        Open in File Browser &rarr;
                    </Link>
                </div>
            </div>

            {/* Summary stats */}
            <div
                className="grid grid-cols-4 mb-10"
                style={{ backgroundColor: 'rgba(233, 188, 181, 0.15)', gap: '1px' }}
            >
                <StatCard
                    label="Recordings"
                    value={stats.fileCount.toLocaleString()}
                    sublabel="In this dataset"
                />
                <StatCard
                    label="Audio"
                    value={stats.audioLabel}
                    sublabel="Total duration"
                />
                <StatCard
                    label="Languages"
                    value={stats.languageCount || '\u2014'}
                    sublabel="Detected across samples"
                />
                <StatCard
                    label="Avg. WER"
                    value={stats.avgWer != null ? `${stats.avgWer}%` : '\u2014'}
                    sublabel={`${stats.avgSpeakers} avg speakers / clip`}
                    accent
                />
            </div>

            {/* Description & metadata panel */}
            <div
                className="grid grid-cols-3 gap-6 mb-10 p-8"
                style={{ backgroundColor: '#ffffff' }}
            >
                <div className="col-span-2">
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-3"
                        style={{ color: '#7a7574' }}
                    >
                        About This Dataset
                    </p>
                    {descriptionText ? (
                        <p
                            className="text-[0.9375rem] leading-relaxed"
                            style={{ color: '#1c1b1b' }}
                        >
                            {descriptionText}
                        </p>
                    ) : (
                        <p className="text-[0.8125rem] italic" style={{ color: '#7a7574' }}>
                            No description provided.
                        </p>
                    )}

                    {tags.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-1.5">
                            {tags.map((t) => (
                                <Tag key={t}>{t}</Tag>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-5" style={{ borderLeft: '1px solid rgba(233, 188, 181, 0.35)', paddingLeft: '1.5rem' }}>
                    <div>
                        <p
                            className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                            style={{ color: '#7a7574' }}
                        >
                            Dataset ID
                        </p>
                        <p
                            className="text-[0.75rem] font-mono break-all"
                            style={{ color: '#1c1b1b' }}
                        >
                            {datasetId}
                        </p>
                    </div>
                    <div>
                        <p
                            className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                            style={{ color: '#7a7574' }}
                        >
                            Type
                        </p>
                        <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                            {isSource ? 'Source (read-only)' : 'Engineer curated'}
                        </p>
                    </div>
                    {isSource && meta.languages && (
                        <div>
                            <p
                                className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                                style={{ color: '#7a7574' }}
                            >
                                Declared Languages
                            </p>
                            <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                                {meta.languages.join(' + ')}
                            </p>
                        </div>
                    )}
                    {isCustom && (
                        <>
                            <div>
                                <p
                                    className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                                    style={{ color: '#7a7574' }}
                                >
                                    Created By
                                </p>
                                <OwnerBadge owner={customDataset.createdBy} size="sm" />
                            </div>
                            <div>
                                <p
                                    className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1"
                                    style={{ color: '#7a7574' }}
                                >
                                    Created
                                </p>
                                <p className="text-[0.8125rem] font-bold" style={{ color: '#1c1b1b' }}>
                                    {formatDate(customDataset.createdAt)}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Selected recordings list */}
            <div className="mb-6">
                <div className="flex items-end justify-between mb-4">
                    <div>
                        <h2
                            className="text-[0.875rem] font-bold uppercase tracking-widest"
                            style={{ color: '#1c1b1b' }}
                        >
                            Selected Recordings
                            <span
                                className="ml-3 text-[0.6875rem] font-semibold"
                                style={{ color: '#7a7574' }}
                            >
                                ({stats.fileCount.toLocaleString()})
                            </span>
                        </h2>
                        <p
                            className="text-[0.6875rem] uppercase tracking-widest mt-1"
                            style={{ color: '#7a7574' }}
                        >
                            {isCustom
                                ? canEdit
                                    ? 'Tick the hold-out box to reserve a recording for the competition evaluation \u2014 held-out files are withheld from training.'
                                    : 'Only the dataset creator can adjust the hold-out selection.'
                                : 'Read-only preview \u00b7 Use the file browser for playback, editing & curation'}
                        </p>
                    </div>
                    <Link
                        href={`/files?dataset=${datasetId}`}
                        className="text-[0.6875rem] font-semibold uppercase tracking-widest no-underline"
                        style={{ color: '#b20100' }}
                    >
                        Edit In File Browser &rarr;
                    </Link>
                </div>

                {isCustom && files.length > 0 && (
                    <div
                        className="flex items-center justify-between px-5 py-3 mb-3"
                        style={{
                            backgroundColor: unseenCount > 0 ? '#1c1b1b' : '#ffffff',
                            color: unseenCount > 0 ? '#ffffff' : '#1c1b1b',
                            borderLeft: `3px solid ${unseenCount > 0 ? '#b20100' : 'rgba(233, 188, 181, 0.5)'}`,
                        }}
                    >
                        <div className="flex items-center gap-4 min-w-0">
                            <span className="text-[0.75rem] font-bold uppercase tracking-widest shrink-0">
                                Unseen Hold-out
                            </span>
                            <span
                                className="text-[0.6875rem] uppercase tracking-widest truncate"
                                style={{ color: unseenCount > 0 ? 'rgba(255,255,255,0.7)' : '#7a7574' }}
                            >
                                {unseenCount.toLocaleString()} of {files.length.toLocaleString()} recordings reserved for competition evaluation
                                {unseenCount > 0 && ` \u00b7 ${(files.length - unseenCount).toLocaleString()} available for training`}
                            </span>
                        </div>
                        {canEdit && (
                            <div className="flex items-center gap-2 shrink-0">
                                {unseenCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => updateDatasetUnseen(datasetId, [])}
                                        className="px-3 py-1.5 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{
                                            backgroundColor: 'transparent',
                                            border: '1.5px solid rgba(255,255,255,0.4)',
                                            borderRadius: '0px',
                                            color: '#ffffff',
                                        }}
                                    >
                                        Clear Hold-out
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={toggleAllUnseen}
                                    className="px-3 py-1.5 text-[0.625rem] font-semibold uppercase tracking-widest cursor-pointer"
                                    style={{
                                        background: unseenCount > 0
                                            ? 'linear-gradient(135deg, #b20100, #e10000)'
                                            : '#1c1b1b',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '0px',
                                    }}
                                >
                                    {allUnseen ? 'Unmark All' : 'Hold Out All'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {files.length === 0 ? (
                    <div className="p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
                        <p className="text-[0.875rem] mb-1" style={{ color: '#1c1b1b' }}>
                            No recordings associated with this dataset yet.
                        </p>
                        <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                            {isCustom
                                ? 'This engineer set has no files attached. Add files from the file browser.'
                                : 'The source catalogue returned no samples for this id.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ backgroundColor: '#ffffff' }}>
                        <div
                            className="flex items-center px-6 py-4 text-[0.625rem] font-semibold uppercase tracking-widest"
                            style={{
                                color: '#7a7574',
                                borderBottom: '1px solid rgba(233, 188, 181, 0.25)',
                            }}
                        >
                            {isCustom && (
                                <div className="w-10 flex items-center" title={canEdit ? 'Mark all as unseen hold-out' : 'Hold-out column (read-only)'}>
                                    <input
                                        type="checkbox"
                                        disabled={!canEdit}
                                        checked={allUnseen}
                                        ref={(el) => {
                                            if (el) el.indeterminate = unseenCount > 0 && !allUnseen;
                                        }}
                                        onChange={toggleAllUnseen}
                                        aria-label="Mark all files as unseen"
                                        style={{
                                            accentColor: '#b20100',
                                            cursor: canEdit ? 'pointer' : 'not-allowed',
                                            width: '1rem',
                                            height: '1rem',
                                        }}
                                    />
                                </div>
                            )}
                            <div className="w-8" />
                            <div className="flex-1">Recording</div>
                            <div className="w-32 text-center">Owner</div>
                            <div className="w-28 text-center">Status</div>
                            <div className="w-24 text-center">Uploaded</div>
                            <div className="w-20 text-center">Duration</div>
                            <div className="w-28 text-center">Language</div>
                            <div className="w-16 text-center">WER</div>
                            <div className="w-40 text-right">Original Location</div>
                        </div>
                        {files.map((file) => {
                            const isUnseen = unseenSet.has(file.id);
                            return (
                            <div
                                key={file.id}
                                className="flex items-center px-6 py-4"
                                style={{
                                    borderBottom: '1px solid rgba(233, 188, 181, 0.08)',
                                    backgroundColor: isUnseen ? 'rgba(178, 1, 0, 0.04)' : 'transparent',
                                    boxShadow: isUnseen ? 'inset 3px 0 0 0 #b20100' : 'none',
                                }}
                            >
                                {isCustom && (
                                    <div className="w-10 flex items-center">
                                        <input
                                            type="checkbox"
                                            disabled={!canEdit}
                                            checked={isUnseen}
                                            onChange={() => toggleUnseen(file.id)}
                                            aria-label={`Mark ${file.name} as unseen hold-out`}
                                            title={canEdit
                                                ? (isUnseen ? 'Remove from hold-out' : 'Reserve for competition evaluation')
                                                : 'Only the dataset creator can change hold-out'}
                                            style={{
                                                accentColor: '#b20100',
                                                cursor: canEdit ? 'pointer' : 'not-allowed',
                                                width: '1rem',
                                                height: '1rem',
                                            }}
                                        />
                                    </div>
                                )}
                                <div className="w-8 flex justify-center">
                                    <FileIcon />
                                </div>
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="flex items-center gap-2">
                                        <p
                                            className="text-[0.8125rem] font-medium truncate"
                                            style={{ color: '#1c1b1b' }}
                                            title={file.name}
                                        >
                                            {file.name.replace(/\.[^.]+$/, '')}
                                        </p>
                                        {isUnseen && (
                                            <span
                                                className="shrink-0 px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-widest"
                                                style={{ backgroundColor: '#b20100', color: '#ffffff' }}
                                            >
                                                Hold-out
                                            </span>
                                        )}
                                    </div>
                                    <p
                                        className="text-[0.6875rem] font-mono mt-0.5 truncate"
                                        style={{ color: '#7a7574' }}
                                    >
                                        {file.id}
                                    </p>
                                </div>
                                <div
                                    className="w-32 text-center text-[0.75rem] truncate"
                                    style={{ color: '#7a7574' }}
                                >
                                    {file.ownerName || '\u2014'}
                                </div>
                                <div className="w-28 text-center">
                                    <StatusBadge status={file.status} />
                                </div>
                                <div
                                    className="w-24 text-center text-[0.75rem]"
                                    style={{ color: '#7a7574' }}
                                >
                                    {formatDate(file.uploaded_at)}
                                </div>
                                <div
                                    className="w-20 text-center text-[0.75rem] font-mono"
                                    style={{ color: '#7a7574' }}
                                >
                                    {file.duration || '\u2014'}
                                </div>
                                <div
                                    className="w-28 text-center text-[0.75rem]"
                                    style={{ color: '#7a7574' }}
                                >
                                    {file.detectedLanguage || '\u2014'}
                                </div>
                                <div
                                    className="w-16 text-center text-[0.75rem]"
                                    style={{
                                        color:
                                            file.wer != null && file.wer !== 'NA'
                                                ? '#b20100'
                                                : '#7a7574',
                                    }}
                                >
                                    {file.wer != null && file.wer !== 'NA'
                                        ? `${file.wer}%`
                                        : '\u2014'}
                                </div>
                                <div className="w-40 flex justify-end">
                                    <LocationLink file={file} />
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Export & analyze */}
            <div
                className="flex items-center justify-between gap-6 mt-4 mb-2 p-6"
                style={{ backgroundColor: '#ffffff', borderLeft: '3px solid #b20100' }}
            >
                <div className="min-w-0">
                    <p
                        className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1"
                        style={{ color: '#b20100' }}
                    >
                        Export &amp; Analyze
                    </p>
                    <h3
                        className="text-[1.125rem] font-bold tracking-tight mb-1"
                        style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}
                    >
                        Spin up an analysis environment
                    </h3>
                    <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                        Pull the {stats.fileCount.toLocaleString()} recordings together with the authorized <span className="font-mono" style={{ color: '#1c1b1b' }}>austin/engineer-eda</span> docker image {'\u2014'} run locally or on a provisioned cloud VM.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={openExport}
                    className="px-5 py-3 text-[0.6875rem] font-semibold uppercase tracking-widest cursor-pointer shrink-0"
                    style={{
                        background: 'linear-gradient(135deg, #b20100, #e10000)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '0px',
                    }}
                >
                    Export Dataset &rarr;
                </button>
            </div>

            {/* Audit footer */}
            <div
                className="flex items-center justify-between mt-10 pt-4 text-[0.625rem] uppercase tracking-widest"
                style={{
                    color: '#7a7574',
                    borderTop: '1px solid rgba(233, 188, 181, 0.2)',
                }}
            >
                <span>
                    {isSource
                        ? `Provisioning: data_collection/sampled_datasets/${sourceDataset.source}`
                        : `Stored locally via austin.datasets`}
                </span>
                <span>
                    Compliance Hash: DS-{(datasetId || '').toString().slice(-4).toUpperCase()}-
                    {stats.fileCount.toString(16).toUpperCase()} Verified
                </span>
                <span>{isSource ? 'Storage: On-Premise Enclave' : 'Storage: Browser (localStorage)'}</span>
            </div>

            {exportOpen && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{ backgroundColor: 'rgba(28, 27, 27, 0.55)' }}
                    onClick={exportPhase === 'running' ? undefined : closeExport}
                >
                    <div
                        className="p-6"
                        style={{ backgroundColor: '#ffffff', width: '560px', maxWidth: '100%', borderTop: '3px solid #b20100' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: '#b20100' }}>
                            Export Dataset
                        </p>
                        <h3 className="text-[1.25rem] font-bold tracking-tight mb-1" style={{ color: '#1c1b1b', letterSpacing: '-0.01em' }}>
                            {displayName}
                        </h3>
                        <p className="text-[0.6875rem] uppercase tracking-widest mb-5" style={{ color: '#7a7574' }}>
                            {stats.fileCount.toLocaleString()} recordings {'\u00b7'} {stats.audioLabel} {'\u00b7'} austin/engineer-eda:latest
                        </p>

                        {exportPhase === 'select' && (
                            <>
                                <div className="mb-5">
                                    <label
                                        htmlFor="export-model"
                                        className="text-[0.625rem] font-semibold uppercase tracking-widest block mb-2"
                                        style={{ color: '#7a7574' }}
                                    >
                                        Model to load into the environment
                                    </label>
                                    {trainingJobs.length === 0 ? (
                                        <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
                                            No training jobs available. The export will use the base checkpoint.
                                        </p>
                                    ) : (
                                        <>
                                            <select
                                                id="export-model"
                                                value={exportModelId}
                                                onChange={(e) => setExportModelId(e.target.value)}
                                                className="w-full px-3 py-2 text-[0.8125rem]"
                                                style={{ backgroundColor: '#f6f3f2', border: 'none', borderBottom: '2px solid #c4c4c4', borderRadius: '0px', color: '#1c1b1b' }}
                                            >
                                                {trainingJobs.map((job) => (
                                                    <option key={job.id} value={job.id}>
                                                        {job.baseModel} {'\u00b7'} {job.id} {'\u00b7'} {job.status.toUpperCase()}
                                                    </option>
                                                ))}
                                            </select>
                                            {(() => {
                                                const j = trainingJobs.find((x) => x.id === exportModelId);
                                                if (!j) return null;
                                                return (
                                                    <p className="text-[0.6875rem] mt-1.5" style={{ color: '#7a7574' }}>
                                                        <span className="font-mono">r={j.rank}</span> {'\u00b7'} <span className="font-mono">lr={j.lr}</span> {'\u00b7'} {j.progress}% trained {'\u00b7'} synced from Training Jobs
                                                    </p>
                                                );
                                            })()}
                                        </>
                                    )}
                                </div>

                                <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-2" style={{ color: '#7a7574' }}>
                                    Where should this environment run?
                                </p>
                                <div className="flex flex-col gap-2 mb-5">
                                    {[
                                        {
                                            key: 'local',
                                            title: 'This Machine',
                                            desc: 'Pull dataset & docker image to your workstation. Use when you already have local GPU or disk headroom.',
                                            badge: 'LOCAL',
                                        },
                                        {
                                            key: 'vm',
                                            title: 'Provision Cloud VM',
                                            desc: 'Spin up a secured analysis VM preloaded with the dataset and EDA toolchain. Routed through the compliance enclave.',
                                            badge: 'REMOTE',
                                        },
                                    ].map((opt) => {
                                        const active = exportTarget === opt.key;
                                        return (
                                            <button
                                                key={opt.key}
                                                type="button"
                                                onClick={() => setExportTarget(opt.key)}
                                                className="flex items-start gap-3 p-4 text-left cursor-pointer w-full"
                                                style={{
                                                    backgroundColor: active ? 'rgba(178, 1, 0, 0.04)' : '#f6f3f2',
                                                    border: `2px solid ${active ? '#b20100' : 'transparent'}`,
                                                    borderRadius: '0px',
                                                }}
                                            >
                                                <span
                                                    className="mt-0.5 shrink-0 flex items-center justify-center"
                                                    style={{
                                                        width: '14px',
                                                        height: '14px',
                                                        borderRadius: '50%',
                                                        border: `2px solid ${active ? '#b20100' : '#c4c4c4'}`,
                                                        backgroundColor: '#ffffff',
                                                    }}
                                                    aria-hidden
                                                >
                                                    {active && (
                                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#b20100' }} />
                                                    )}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-[0.875rem] font-bold" style={{ color: '#1c1b1b' }}>{opt.title}</span>
                                                        <span
                                                            className="text-[0.5625rem] font-semibold uppercase tracking-widest px-1.5 py-0.5"
                                                            style={{ backgroundColor: active ? '#b20100' : '#1c1b1b', color: '#ffffff' }}
                                                        >
                                                            {opt.badge}
                                                        </span>
                                                    </div>
                                                    <p className="text-[0.75rem] leading-relaxed" style={{ color: '#7a7574' }}>
                                                        {opt.desc}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="p-3 mb-5" style={{ backgroundColor: '#f6f3f2' }}>
                                    <p className="text-[0.5625rem] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#7a7574' }}>
                                        This export bundles
                                    </p>
                                    <ul className="text-[0.75rem] space-y-0.5" style={{ color: '#1c1b1b', listStyle: 'none', padding: 0 }}>
                                        <li>{'\u2022'} {stats.fileCount.toLocaleString()} audio recordings + transcripts</li>
                                        {(() => {
                                            const j = trainingJobs.find((x) => x.id === exportModelId);
                                            return (
                                                <li>
                                                    {'\u2022'} Model weights: {j ? <><span className="font-bold">{j.baseModel}</span> <span className="font-mono" style={{ color: '#7a7574' }}>({j.id})</span></> : 'base checkpoint'}
                                                </li>
                                            );
                                        })()}
                                        <li>{'\u2022'} <span className="font-mono">austin/engineer-eda:latest</span> (authorized packages for model interaction &amp; EDA)</li>
                                        <li>{'\u2022'} Read-only credentials scoped to this dataset</li>
                                    </ul>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={closeExport}
                                        className="px-4 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(28,27,27,0.2)', borderRadius: '0px', color: '#1c1b1b' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={startExport}
                                        className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer"
                                        style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
                                    >
                                        {exportTarget === 'vm' ? 'Provision VM' : 'Pull Locally'} &rarr;
                                    </button>
                                </div>
                            </>
                        )}

                        {(exportPhase === 'running' || exportPhase === 'done') && (
                            <>
                                <div
                                    className="p-4 mb-4"
                                    style={{
                                        backgroundColor: '#1c1b1b',
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                        minHeight: '180px',
                                    }}
                                >
                                    {exportLog.map((line, i) => {
                                        const isLast = i === exportLog.length - 1;
                                        const isFinal = exportPhase === 'done' && isLast;
                                        const pending = exportPhase === 'running' && isLast;
                                        return (
                                            <div key={i} className="flex items-start gap-2 text-[0.75rem] leading-relaxed">
                                                <span
                                                    className="shrink-0 mt-1.5"
                                                    style={{
                                                        width: '6px',
                                                        height: '6px',
                                                        borderRadius: '50%',
                                                        backgroundColor: isFinal ? '#e10000' : pending ? '#e10000' : '#1a7f37',
                                                        animation: pending ? 'pulse 1s ease-in-out infinite' : 'none',
                                                        boxShadow: pending ? '0 0 8px rgba(225,0,0,0.8)' : 'none',
                                                    }}
                                                />
                                                <span style={{ color: isFinal || pending ? '#ffffff' : 'rgba(255,255,255,0.65)' }}>
                                                    {line}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {exportPhase === 'running' && exportLog.length === 0 && (
                                        <span className="text-[0.75rem]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                                            Initialising export...
                                        </span>
                                    )}
                                </div>

                                <style jsx>{`
                                    @keyframes pulse {
                                        0%, 100% { opacity: 1; }
                                        50% { opacity: 0.35; }
                                    }
                                `}</style>

                                {exportPhase === 'done' && (
                                    <div className="p-3 mb-4" style={{ backgroundColor: 'rgba(178, 1, 0, 0.06)', borderLeft: '3px solid #b20100' }}>
                                        <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#b20100' }}>
                                            Handoff complete
                                        </p>
                                        <p className="text-[0.75rem]" style={{ color: '#1c1b1b' }}>
                                            Session handoff URL has been issued. You&apos;ll be redirected to the {exportTarget === 'vm' ? 'remote analysis VM' : 'local container shell'} once the network negotiates.
                                        </p>
                                    </div>
                                )}

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={closeExport}
                                        disabled={exportPhase === 'running'}
                                        className="px-5 py-2 text-[0.75rem] font-semibold uppercase tracking-widest cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                            background: exportPhase === 'done' ? 'linear-gradient(135deg, #b20100, #e10000)' : 'transparent',
                                            color: exportPhase === 'done' ? '#ffffff' : '#1c1b1b',
                                            border: exportPhase === 'done' ? 'none' : '1.5px solid rgba(28,27,27,0.2)',
                                            borderRadius: '0px',
                                        }}
                                    >
                                        {exportPhase === 'done' ? 'Close' : 'Provisioning...'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
