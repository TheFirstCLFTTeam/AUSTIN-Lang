// Test-only shim for the `server-only` package. The real package throws
// when imported in client-side bundles; under vitest we run server modules
// directly in Node, so this is a no-op.
export {};
