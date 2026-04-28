'use client';

import { setWasmUrl } from '@lottiefiles/dotlottie-react';

// Self-host the dotlottie WASM so the CSP can keep `connect-src 'self'`. The
// upstream library defaults to fetching the WASM from cdn.jsdelivr.net /
// unpkg.com, which would either need those CDNs in the CSP or break in air-
// gapped deploys. The .wasm is copied from node_modules into /public at the
// same time as this file lands.
if (typeof window !== 'undefined') {
    setWasmUrl('/dotlottie-player.wasm');
}

export default function LottieWasmInit() {
    return null;
}
