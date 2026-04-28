// Dumps the frontend mock ES modules into seed/fixtures/*.json.
//
// Run via `npm run dump` (see package.json) so the JSON loader hook is
// registered first. The Python seeders read these fixtures — they never
// touch the JS files directly.
//
// Dependency order (see plan):
//   Level 0: mock_data-users, mock_data-dataset, training-jobs,
//            mock_data-metrics-metadata, mock_data-dashboard,
//            mock_data-leaderboard, mock_data-leaderboard-custom
//   Level 1: group-policies (imports USER_GROUP_CATALOGUE),
//            sampled-datasets (imports JSON), mock_data-audit (imports users)
//   Level 2: mock-data (imports sampled + users), audit_events (runs
//            getAuditTrail per sampled file)

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

const SRC = '../../frontend/src/services';

async function write(name, data) {
    const file = path.join(FIXTURES, `${name}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
    console.log(`  ${name.padEnd(32)} → ${count} entries`);
}

async function main() {
    await fs.mkdir(FIXTURES, { recursive: true });
    console.log(`Writing fixtures to ${FIXTURES}\n`);

    // ── Level 0 ─────────────────────────────────────────────────────────────
    console.log('Level 0:');

    const usersMod = await import(`${SRC}/mock_data-users.js`);
    await write('users', usersMod.users);
    await write('clients', usersMod.MOCK_CLIENTS);
    await write('user_profiles', usersMod.MOCK_USER_PROFILES);
    await write('groups', usersMod.USER_GROUP_CATALOGUE);
    await write('group_assignments', usersMod.INITIAL_USER_GROUP_ASSIGNMENTS);

    const datasetMetaMod = await import(`${SRC}/mock_data-dataset.js`);
    await write('source_dataset_meta', datasetMetaMod.SOURCE_DATASET_META);

    const trainingMod = await import(`${SRC}/training-jobs.js`);
    await write('training_jobs', trainingMod.TRAINING_JOBS);

    const metricsMetaMod = await import(`${SRC}/mock_data-metrics-metadata.js`);
    await write('metrics_metadata', metricsMetaMod.METRICS_METADATA);

    const dashboardMod = await import(`${SRC}/mock_data-dashboard.js`);
    await write('metrics_display', dashboardMod.AVAILABLE_METRICS);
    await write('selected_metric_ids', dashboardMod.DEFAULT_SELECTED_METRIC_IDS);
    await write('critical_term_failures', dashboardMod.MOCK_CRITICAL_TERM_FAILURES);
    await write('accuracy_logs', dashboardMod.MOCK_ACCURACY_LOGS);

    // Leaderboard submissions are keyed by dataset in the source modules.
    // Dump them as flat arrays with a datasetId column for easier SQL
    // insertion downstream.
    const lbMod = await import(`${SRC}/mock_data-leaderboard.js`);
    const lbSource = [];
    // These modules don't export the raw map, only the sorted getter. Call
    // getLeaderboard per dataset id to collect everything.
    for (const datasetId of lbMod.getLeaderboardDatasets()) {
        for (const row of lbMod.getLeaderboard(datasetId)) {
            lbSource.push({ datasetId, ...row });
        }
    }
    await write('leaderboard_source', lbSource);

    const lbCustomMod = await import(`${SRC}/mock_data-leaderboard-custom.js`);
    await write('custom_datasets', lbCustomMod.MOCK_CUSTOM_DATASETS);
    const lbCustom = [];
    for (const ds of lbCustomMod.MOCK_CUSTOM_DATASETS) {
        for (const row of lbCustomMod.getCustomMockLeaderboard(ds.id)) {
            lbCustom.push({ datasetId: ds.id, ...row });
        }
    }
    await write('leaderboard_custom', lbCustom);

    // ── Level 1 ─────────────────────────────────────────────────────────────
    console.log('\nLevel 1:');

    const policiesMod = await import(`${SRC}/group-policies.js`);
    await write('permissions_catalogue', policiesMod.ALL_PERMISSIONS);
    await write('resources_catalogue', policiesMod.ALL_RESOURCES);
    // Snapshot the seeded-in-memory policy for each catalogue group.
    const policies = {};
    for (const g of usersMod.USER_GROUP_CATALOGUE) {
        policies[g.id] = policiesMod.getPolicy(g.id);
    }
    await write('group_policies', policies);

    const sampledMod = await import(`${SRC}/sampled-datasets.js`);
    await write('sampled_folders', sampledMod.SAMPLED_DATASET_FOLDERS);
    await write('sampled_files', sampledMod.SAMPLED_DATASET_FILES);
    await write('root_level_files', sampledMod.ROOT_LEVEL_SAMPLED_FILES);

    const auditMod = await import(`${SRC}/mock_data-audit.js`);
    await write('audit_actions', auditMod.AUDIT_ACTIONS);

    // ── Level 2 ─────────────────────────────────────────────────────────────
    console.log('\nLevel 2:');

    const mockDataMod = await import(`${SRC}/mock-data.js`);
    await write('processing_jobs', mockDataMod.MOCK_PROCESSING_JOBS);

    // Materialise audit events for every sampled + root-level file. The
    // audit generator is deterministic per file id so this produces a stable
    // snapshot on each run.
    const allFiles = [
        ...sampledMod.SAMPLED_DATASET_FILES,
        ...sampledMod.ROOT_LEVEL_SAMPLED_FILES,
    ];
    const auditEvents = [];
    for (const f of allFiles) {
        const events = auditMod.getAuditTrail(f.id, f.uploaded_at);
        for (const ev of events) auditEvents.push(ev);
    }
    await write('audit_events', auditEvents);

    console.log(`\nDone. ${auditEvents.length} audit events materialised across ${allFiles.length} files.`);
}

main().catch((err) => {
    console.error('\ndump_mocks failed:', err);
    process.exit(1);
});
