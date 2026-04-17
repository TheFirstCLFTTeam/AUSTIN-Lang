import 'server-only';

import { platformDb } from './db';

export function listProcessingJobs() {
    const db = platformDb();
    const jobs = db
        .prepare(
            `SELECT id, name, submitted_by, source, source_path, language, status,
                    progress, stage, submitted_at, estimated_completion
               FROM processing_job
              ORDER BY submitted_at DESC`
        )
        .all();

    const recordings = db
        .prepare(
            `SELECT r.id, r.job_id, r.file_name, r.duration, r.size_mb, r.progress,
                    r.status, r.stage, r.error_code, r.error_message, r.error_timestamp,
                    GROUP_CONCAT(rec.cause, '|') AS error_causes
               FROM recording r
               LEFT JOIN recording_error_cause rec ON rec.recording_id = r.id
              GROUP BY r.id`
        )
        .all();

    const byJob = new Map();
    for (const rec of recordings) {
        const arr = byJob.get(rec.job_id) || [];
        const errorCauses = rec.error_causes ? rec.error_causes.split('|') : [];
        const item = {
            id: rec.id,
            fileName: rec.file_name,
            duration: rec.duration,
            sizeMb: rec.size_mb,
            progress: rec.progress,
            status: rec.status,
            stage: rec.stage,
        };
        if (rec.error_code) {
            item.error = {
                code: rec.error_code,
                message: rec.error_message,
                timestamp: rec.error_timestamp,
                commonCauses: errorCauses,
            };
        }
        arr.push(item);
        byJob.set(rec.job_id, arr);
    }

    return jobs.map((j) => ({
        id: j.id,
        name: j.name,
        submittedBy: j.submitted_by,
        source: j.source,
        sourcePath: j.source_path,
        language: j.language,
        status: j.status,
        progress: j.progress,
        stage: j.stage,
        submittedAt: j.submitted_at,
        estimatedCompletion: j.estimated_completion,
        recordings: byJob.get(j.id) || [],
    }));
}
