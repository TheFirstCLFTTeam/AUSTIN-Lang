// Node ESM loader hook for the frontend mock modules.
//
// Two fixes layered in one hook:
//   1. Inject `type: "json"` import attribute for `.json` specifiers — the
//      frontend uses `import X from './foo.json'` without attributes, which
//      Next.js accepts but Node 22+ refuses.
//   2. Resolve extension-less relative specifiers (Next.js convention) by
//      trying `.js` first, falling back to `/index.js`.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

function tryResolveAsJs(specifier, parentURL) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
    const parentPath = parentURL ? fileURLToPath(parentURL) : process.cwd();
    const base = new URL(specifier, pathToFileURL(parentPath));
    const candidates = [`${base.pathname}.js`, `${base.pathname}/index.js`];
    for (const candidate of candidates) {
        const fsPath = decodeURI(candidate);
        const sysPath = process.platform === 'win32' && fsPath.startsWith('/')
            ? fsPath.slice(1)
            : fsPath;
        if (existsSync(sysPath)) {
            return pathToFileURL(sysPath).href;
        }
    }
    return null;
}

export async function resolve(specifier, context, nextResolve) {
    // Bare extension-less relative import → attempt .js resolution first.
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
        const alt = tryResolveAsJs(specifier, context.parentURL);
        if (alt) {
            return { url: alt, shortCircuit: true, format: 'module' };
        }
    }

    const result = await nextResolve(specifier, context);
    if (result.url?.endsWith('.json')) {
        return {
            ...result,
            importAttributes: { ...(result.importAttributes || {}), type: 'json' },
        };
    }
    return result;
}
