// Normalizes the 4 Hugging Face sample datasets into MOCK_FILE_STORE entries.
// Audio is served via /api/mock-audio/<dataset>/audio/<file> which streams
// from ../data_collection/sampled_datasets/ at request time.

import mixedRaw from './sampled-data/mixed-cantonese-english.json';
import wordshkRaw from './sampled-data/wordshk-cantonese.json';
import alvanliiRaw from './sampled-data/alvanlii-youtube.json';
import edmundRaw from './sampled-data/edmundchan-finetune.json';
import earnings22Raw from './sampled-data/earnings22-chunked.json';
import spgispeechRaw from './sampled-data/spgispeech.json';

const OWNER_POOL = [
    { ownerId: 'u1', ownerName: 'Generic User' },
    { ownerId: 'u2', ownerName: 'Engineer User' },
    { ownerId: 'u3', ownerName: 'Admin User' },
    { ownerId: 'u4', ownerName: 'Reviewer User' },
];

const BASE_DATE = new Date('2026-03-10T09:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

function dateFor(globalIdx) {
    return new Date(BASE_DATE + globalIdx * 3 * HOUR).toISOString();
}

function owner(globalIdx) {
    return OWNER_POOL[globalIdx % OWNER_POOL.length];
}

function formatDuration(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Deterministic pseudo-random in [0,1) from a seed string.
function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
}

function syntheticMetrics(id, text, durationSec) {
    const r = seeded(id);
    const totalNumberOfWords = Math.max(
        1,
        text ? text.replace(/\s+/g, '').length : 20, // char-count for CJK proxy
    );
    const wer = Math.round((1 + r * 8) * 10) / 10; // 1.0 – 9.0 %
    const absoluteWordErrorRate = Math.round((wer / 100) * totalNumberOfWords);
    const duration = durationSec
        ? formatDuration(durationSec)
        : formatDuration(6 + r * 24);
    return {
        duration,
        wer,
        absoluteWordErrorRate,
        totalNumberOfWords,
        speakerDetection: 1 + Math.floor(r * 3),
        compliance: r > 0.8 ? 'Pending Review' : 'FR-A01 Approved',
    };
}

function buildEntry({
    datasetKey,
    datasetLabel,
    globalIdx,
    localIdx,
    audioRelPath,
    text,
    displayName,
    detectedLanguage,
    durationSec,
    extras,
}) {
    const id = `ds-${datasetKey}-${String(localIdx).padStart(4, '0')}`;
    const o = owner(globalIdx);
    const audioUrl = `/api/mock-audio/${datasetLabel}/${audioRelPath}`;
    const segments = [
        {
            id: globalIdx * 10 + 1,
            start: 0.0,
            end: durationSec || 10.0,
            text: text || '',
        },
    ];
    const metrics = syntheticMetrics(id, text, durationSec);

    return {
        id,
        ownerId: o.ownerId,
        ownerName: o.ownerName,
        name: displayName,
        audioUrl,
        uploaded_at: dateFor(globalIdx),
        dataset: datasetKey,
        detectedLanguage,
        ...metrics,
        ...extras,
        rawTranscript: {
            id: 1000 + globalIdx * 2,
            audio_file_id: globalIdx + 1000,
            transcript_segments: segments,
        },
        edits: [],
    };
}

function safeSlice(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
}

function buildAll() {
    const out = [];
    let g = 0;

    mixedRaw.forEach((row, i) => {
        out.push(
            buildEntry({
                datasetKey: 'mixed',
                datasetLabel: 'AlienKevin-mixed_cantonese_and_english_speech',
                globalIdx: g++,
                localIdx: i,
                audioRelPath: row.audio,
                text: row.sentence,
                displayName: `[${row.topic || 'Cantonese+EN'}] ${safeSlice(row.sentence, 40)}.wav`,
                detectedLanguage: 'Cantonese + English',
            }),
        );
    });

    wordshkRaw.forEach((row, i) => {
        out.push(
            buildEntry({
                datasetKey: 'wordshk',
                datasetLabel: 'AlienKevin-wordshk_cantonese_speech',
                globalIdx: g++,
                localIdx: i,
                audioRelPath: row.audio,
                text: row.text,
                displayName: `wordshk_${String(i).padStart(4, '0')}.mp3`,
                detectedLanguage: 'Cantonese',
            }),
        );
    });

    alvanliiRaw.forEach((row, i) => {
        const text = row.transcript_whisper || row.transcript_sensevoice || '';
        out.push(
            buildEntry({
                datasetKey: 'alvanlii',
                datasetLabel: 'alvanlii-cantonese-youtube',
                globalIdx: g++,
                localIdx: i,
                audioRelPath: row.audio,
                text,
                displayName: `${safeSlice(row.title || 'youtube_clip', 48)}.mp3`,
                detectedLanguage: 'Cantonese',
                durationSec: row.speech_duration,
                extras: {
                    channel: row.channel,
                    snr: row.snr,
                },
            }),
        );
    });

    edmundRaw.forEach((row, i) => {
        out.push(
            buildEntry({
                datasetKey: 'edmund',
                datasetLabel: 'edmundchan70-Cantonese_fine_tune',
                globalIdx: g++,
                localIdx: i,
                audioRelPath: row.audio,
                text: row.transcription,
                displayName: `finetune_${String(i).padStart(4, '0')}.mp3`,
                detectedLanguage: 'Cantonese',
            }),
        );
    });

    return out;
}

export const SAMPLED_DATASET_FILES = buildAll();

// Root-level recordings — no `dataset` field, so they appear in the user's
// root directory rather than any folder. Audio streams from the on-disk
// sampled_datasets/ tree via the existing /api/mock-audio route.
function buildRootEntry({ datasetLabel, globalIdx, localIdx, audioRelPath, text, displayName, detectedLanguage, durationSec, idPrefix }) {
    const id = `root-${idPrefix}-${String(localIdx).padStart(4, '0')}`;
    const o = owner(globalIdx);
    const audioUrl = `/api/mock-audio/${datasetLabel}/${audioRelPath}`;
    const segments = [
        {
            id: globalIdx * 10 + 1,
            start: 0.0,
            end: durationSec || 10.0,
            text: text || '',
        },
    ];
    const metrics = syntheticMetrics(id, text, durationSec);
    return {
        id,
        ownerId: o.ownerId,
        ownerName: o.ownerName,
        name: displayName,
        audioUrl,
        uploaded_at: dateFor(globalIdx),
        detectedLanguage,
        ...metrics,
        rawTranscript: {
            id: 5000 + globalIdx * 2,
            audio_file_id: globalIdx + 5000,
            transcript_segments: segments,
        },
        edits: [],
    };
}

function buildRootFiles() {
    const out = [];
    let g = 500;
    earnings22Raw.forEach((row, i) => {
        const dur = (row.end_ts ?? 0) - (row.start_ts ?? 0);
        const entry = buildRootEntry({
            datasetLabel: 'distil-whisper-earnings22-chunked',
            globalIdx: g++,
            localIdx: i,
            audioRelPath: row.audio,
            text: row.transcription,
            displayName: `earnings22_${row.file_id}_seg${row.segment_id}.wav`,
            detectedLanguage: 'English (US)',
            durationSec: dur > 0 ? dur : undefined,
            idPrefix: 'earnings22',
        });
        // Soft-delete the first 3 earnings entries for trash testing.
        // deleted_at  = when the user or system initiated the deletion
        // expires_at  = hard cutoff when the file is permanently removed
        // The "Deleted" column shows the later of deleted_at and uploaded_at.
        const RETENTION_DAYS = 7;
        const TRASH_ENTRIES = [
            { upload: '2026-04-01', deletedBy: 'system' },
            { upload: '2026-04-13', deletedBy: 'u1', deletedAt: '2026-04-15T14:32:00Z' },
            { upload: '2026-04-08', deletedBy: 'system' },
        ];
        if (i < TRASH_ENTRIES.length) {
            const cfg = TRASH_ENTRIES[i];
            const uploaded = new Date(cfg.upload + 'T09:00:00Z');
            entry.uploaded_at = uploaded.toISOString();
            // deleted_at: explicit timestamp if user-initiated, otherwise 7 days after upload (system auto-delete)
            entry.deleted_at = cfg.deletedAt || new Date(uploaded.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
            entry.deleted_by = cfg.deletedBy;
            // expires_at: always RETENTION_DAYS after the deletion date
            const deletedMs = new Date(entry.deleted_at).getTime();
            entry.expires_at = new Date(deletedMs + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        }
        out.push(entry);
    });
    spgispeechRaw.forEach((row, i) => {
        out.push(buildRootEntry({
            datasetLabel: 'kensho-spgispeech-S',
            globalIdx: g++,
            localIdx: i,
            audioRelPath: row.audio,
            text: row.transcript,
            displayName: `spgispeech_${String(i).padStart(4, '0')}.wav`,
            detectedLanguage: 'English (US)',
            idPrefix: 'spgispeech',
        }));
    });
    return out;
}

export const ROOT_LEVEL_SAMPLED_FILES = buildRootFiles();

// Names match the on-disk folder names created by
// data_collection/init.py (dataset_name.replace('/', '-')), so a folder in
// the UI is identifiable 1:1 with a directory under sampled_datasets/.
export const SAMPLED_DATASET_FOLDERS = [
    {
        id: 'mixed',
        source: 'AlienKevin/mixed_cantonese_and_english_speech',
    },
    {
        id: 'wordshk',
        source: 'AlienKevin/wordshk_cantonese_speech',
    },
    {
        id: 'alvanlii',
        source: 'alvanlii/cantonese-youtube',
    },
    {
        id: 'edmund',
        source: 'edmundchan70/Cantonese_fine_tune',
    },
].map((f) => ({
    ...f,
    name: f.source.replace('/', '-'),
    fileCount: SAMPLED_DATASET_FILES.filter((x) => x.dataset === f.id).length,
}));