/**
 * Does this build carry the on-device graph engine?
 *
 * `scripts/tauri.sh` drives this flag and the Cargo `local-mode` feature from
 * one value, so the frontend can never believe in an engine the binary was
 * compiled without. Default: on for `dev`, off for a build — SurrealDB alone is
 * ~60 MB, and docs/ARCHITECTURE.md § "Local-only mode" carries the reasoning.
 *
 * Read through `import.meta.env` rather than `$env/static/public`, which throws
 * when the variable is unset.
 */
export const LOCAL_MODE_AVAILABLE: boolean = (() => {
	const raw = String(import.meta.env.PUBLIC_ENABLE_LOCAL_MODE ?? '').toLowerCase();
	if (raw === 'true' || raw === '1') return true;
	if (raw === 'false' || raw === '0') return false;
	return !!import.meta.env.DEV;
})();
