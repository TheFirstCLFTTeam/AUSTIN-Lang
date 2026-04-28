import type { NextConfig } from 'next'

// Static security headers applied to every response. The CSP itself is set
// per-request from middleware.ts (so each request gets its own nonce); this
// block carries the headers that don't change per request.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HSTS only carries weight when served over HTTPS. Harmless over HTTP — the
  // browser ignores it. Will be activated in earnest once the reverse proxy
  // (Azure Front Door) is in place.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  distDir: 'build',
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: {
    '/*': ['node_modules/better-sqlite3/**/*'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

export default nextConfig
