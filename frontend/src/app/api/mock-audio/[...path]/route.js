import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

// Root of the sampled audio corpus, relative to the frontend project.
const DATASETS_ROOT = path.resolve(
    process.cwd(),
    '..',
    'data_collection',
    'sampled_datasets',
);

const MIME_BY_EXT = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
};

export async function GET(_req, ctx) {
    const { path: segments } = await ctx.params;

    // Resolve inside DATASETS_ROOT and guard against traversal.
    const requested = path.resolve(DATASETS_ROOT, ...segments);
    if (!requested.startsWith(DATASETS_ROOT + path.sep)) {
        return new Response('Forbidden', { status: 403 });
    }

    let fileStat;
    try {
        fileStat = await stat(requested);
    } catch {
        return new Response('Not found', { status: 404 });
    }
    if (!fileStat.isFile()) {
        return new Response('Not found', { status: 404 });
    }

    const ext = path.extname(requested).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';

    const nodeStream = createReadStream(requested);
    const webStream = Readable.toWeb(nodeStream);

    return new Response(webStream, {
        headers: {
            'Content-Type': contentType,
            'Content-Length': String(fileStat.size),
            'Cache-Control': 'public, max-age=3600',
        },
    });
}