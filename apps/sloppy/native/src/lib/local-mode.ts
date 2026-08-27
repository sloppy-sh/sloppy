/**
 * Does this build carry the on-device graph engine? `scripts/tauri.sh` is the
 * only writer of PUBLIC_ENABLE_LOCAL_MODE, so anything else — unset included —
 * means no engine was compiled in. docs/ARCHITECTURE.md § "Local-only mode".
 *
 * Read through `import.meta.env` rather than `$env/static/public`, which throws
 * when the variable is unset.
 */
export const LOCAL_MODE_AVAILABLE: boolean = import.meta.env.PUBLIC_ENABLE_LOCAL_MODE === 'true';
