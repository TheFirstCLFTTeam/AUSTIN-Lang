// Seed for the holdouts service. Mirrors database(FE)/seed/fixtures/
// holdout_membership.json so that the in-memory store starts populated even
// before the API exists. When the backend lands, this becomes a fallback
// for the unauthenticated / offline path only.

export const HOLDOUT_MEMBERSHIP_SEED = [
    { datasetId: 'mixed',    audioFileExternalId: 'ds-mixed-0001',    markedBy: 'u2', markedAt: '2026-04-10T09:00:00Z' },
    { datasetId: 'mixed',    audioFileExternalId: 'ds-mixed-0007',    markedBy: 'u2', markedAt: '2026-04-10T09:00:05Z' },
    { datasetId: 'wordshk',  audioFileExternalId: 'ds-wordshk-0002',  markedBy: 'u2', markedAt: '2026-04-10T09:01:00Z' },
    { datasetId: 'wordshk',  audioFileExternalId: 'ds-wordshk-0008',  markedBy: 'u2', markedAt: '2026-04-10T09:01:04Z' },
    { datasetId: 'alvanlii', audioFileExternalId: 'ds-alvanlii-0003', markedBy: 'u2', markedAt: '2026-04-10T09:02:00Z' },
    { datasetId: 'alvanlii', audioFileExternalId: 'ds-alvanlii-0006', markedBy: 'u2', markedAt: '2026-04-10T09:02:03Z' },
    { datasetId: 'edmund',   audioFileExternalId: 'ds-edmund-0004',   markedBy: 'u2', markedAt: '2026-04-10T09:03:00Z' },
    { datasetId: 'edmund',   audioFileExternalId: 'ds-edmund-0009',   markedBy: 'u2', markedAt: '2026-04-10T09:03:02Z' },
];
