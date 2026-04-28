// Mock data for the Datasets surface area.
// Separated from mock-data.js so the catalogue page (and its detail view)
// can evolve without touching user / client / metrics mocks.
//
// Contains:
//   1. SOURCE_DATASET_META    — editorial metadata per Hugging Face source set
//   2. DATASET_TAG_CATALOGUE  — taxonomy of labels engineers can apply to
//                               custom datasets when curating from
//                               "My Transcripts". Mirrors the tags used on
//                               source datasets so engineer sets are
//                               greppable against the same vocabulary when
//                               routed into training jobs.

export const SOURCE_DATASET_META = {
    mixed: {
        languages: ['Cantonese', 'English'],
        origin: 'Hugging Face \u00b7 AlienKevin',
        purpose: 'Code-switch training',
        description:
            'Mixed Cantonese-English speech drawn from interview and call-centre recordings. The primary training signal for the model\u2019s code-switching behaviour.',
        tags: ['code-switch', 'conversational', 'noisy'],
        status: 'Active',
    },
    wordshk: {
        languages: ['Cantonese'],
        origin: 'Hugging Face \u00b7 AlienKevin',
        purpose: 'Pronunciation priors',
        description:
            'Read-aloud Cantonese dictionary entries sourced from words.hk. Short, clean utterances used to bias the acoustic model toward canonical pronunciations.',
        tags: ['dictionary', 'read-speech', 'clean'],
        status: 'Active',
    },
    alvanlii: {
        languages: ['Cantonese'],
        origin: 'Hugging Face \u00b7 alvanlii',
        purpose: 'Spontaneous conversational',
        description:
            'Cantonese YouTube audio spanning vlogs, interviews, and podcasts. Dominant source of naturalistic Cantonese for the current fine-tune.',
        tags: ['youtube', 'conversational', 'spontaneous'],
        status: 'Active',
    },
    edmund: {
        languages: ['Cantonese'],
        origin: 'Hugging Face \u00b7 edmundchan70',
        purpose: 'Supervised fine-tune',
        description:
            'Curated, speaker-balanced Cantonese fine-tuning set. Used for the supervised pass after the mixed code-switch training stage.',
        tags: ['fine-tune', 'curated', 'balanced'],
        status: 'Active',
    },
};

export const DATASET_TAG_CATALOGUE = [
    // Sub-task / speech style — describes *what* the recording is
    { value: 'code-switch', group: 'Subtask' },
    { value: 'conversational', group: 'Subtask' },
    { value: 'read-speech', group: 'Subtask' },
    { value: 'spontaneous', group: 'Subtask' },
    { value: 'dictation', group: 'Subtask' },
    { value: 'dictionary', group: 'Subtask' },
    { value: 'long-form', group: 'Subtask' },
    { value: 'short-form', group: 'Subtask' },

    // Acoustic conditions — describes the channel
    { value: 'noisy', group: 'Acoustic' },
    { value: 'clean', group: 'Acoustic' },
    { value: 'reverberant', group: 'Acoustic' },
    { value: 'phone', group: 'Acoustic' },
    { value: 'studio', group: 'Acoustic' },
    { value: 'outdoor', group: 'Acoustic' },

    // Source medium
    { value: 'youtube', group: 'Source' },
    { value: 'podcast', group: 'Source' },
    { value: 'call-centre', group: 'Source' },
    { value: 'interview', group: 'Source' },
    { value: 'broadcast', group: 'Source' },
    { value: 'synthetic', group: 'Source' },
    { value: 'earnings-call', group: 'Source' },

    // Speaker composition
    { value: 'single-speaker', group: 'Speakers' },
    { value: 'multi-speaker', group: 'Speakers' },
    { value: 'balanced', group: 'Speakers' },
    { value: 'high-diversity', group: 'Speakers' },

    // Intended training purpose
    { value: 'fine-tune', group: 'Purpose' },
    { value: 'evaluation', group: 'Purpose' },
    { value: 'calibration', group: 'Purpose' },
    { value: 'stress-test', group: 'Purpose' },
    { value: 'regression-pack', group: 'Purpose' },
    { value: 'curated', group: 'Purpose' },

    // Language footprint
    { value: 'cantonese', group: 'Language' },
    { value: 'mandarin', group: 'Language' },
    { value: 'english', group: 'Language' },
    { value: 'mixed', group: 'Language' },
];
