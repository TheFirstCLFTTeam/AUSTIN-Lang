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

// Additional mount points. When the first URL segment matches a key here,
// the remaining segments are resolved against the mapped directory instead
// of DATASETS_ROOT. Leaves existing /api/mock-audio/<dataset>/... URLs
// untouched.
const MOUNTS = {
    multispeak: path.resolve(DATASETS_ROOT, '..', 'multispeak_maker'),
};

const MIME_BY_EXT = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
};

export async function GET(_req, ctx) {
    const { path: segments } = await ctx.params;

    const [first, ...rest] = segments;
    const mountRoot = MOUNTS[first];
    const root = mountRoot || DATASETS_ROOT;
    const relSegments = mountRoot ? rest : segments;

    // Resolve inside the chosen root and guard against traversal.
    const requested = path.resolve(root, ...relSegments);
    if (!requested.startsWith(root + path.sep)) {
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