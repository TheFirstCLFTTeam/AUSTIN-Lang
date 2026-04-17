import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  distDir: 'build',
  output: 'standalone',
  // better-sqlite3 ships a native .node binary — webpack can't bundle it.
  serverExternalPackages: ['better-sqlite3'],
  // The native binary lives outside JS imports, so the standalone tracer needs
  // an explicit hint to include it.
  outputFileTracingIncludes: {
    '/*': ['node_modules/better-sqlite3/**/*'],
  },
}

export default nextConfig
