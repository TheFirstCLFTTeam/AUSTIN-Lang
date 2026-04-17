// Thin fetch wrapper. By default it talks to the Next.js process itself
// (relative URLs hit the in-process route handlers under src/app/**/route.js).
// Set NEXT_PUBLIC_API_URL to point at an external service.
// Always sends cookies (`credentials: 'include'`) since auth is JWT-via-cookie,
// and always parses JSON when there's a body.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function request(method, path, body, { headers = {}, signal, server } = {}) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const init = {
        method,
        credentials: 'include',
        headers: { Accept: 'application/json', ...headers },
        signal,
    };
    if (body !== undefined && body !== null) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
    }
    if (server && server.cookieHeader) {
        // Server-side caller is forwarding the browser's Cookie header.
        init.headers.Cookie = server.cookieHeader;
    }

    let res;
    try {
        res = await fetch(url, init);
    } catch (err) {
        const wrapped = new Error(`Network error calling ${method} ${url}: ${err.message}`);
        wrapped.cause = err;
        throw wrapped;
    }

    const text = await res.text();
    const data = text ? safeParseJson(text) : null;

    if (!res.ok) {
        const err = new Error(
            (data && (data.detail || data.message)) ||
            `HTTP ${res.status} on ${method} ${url}`,
        );
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

function safeParseJson(text) {
    try { return JSON.parse(text); } catch { return text; }
}

export const http = {
    get:  (path, opts) => request('GET', path, null, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put:  (path, body, opts) => request('PUT', path, body, opts),
    del:  (path, opts) => request('DELETE', path, null, opts),
};
