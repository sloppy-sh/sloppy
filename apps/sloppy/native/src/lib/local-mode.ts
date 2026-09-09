/**
 * Does this build open a graph as a folder on the device, with no API and no
 * sign-in? `scripts/tauri.sh` is the only writer of PUBLIC_ENABLE_LOCAL_MODE, so
 * anything else — unset included — is a build that talks to a server.
 * docs/ARCHITECTURE.md § "Local-only mode".
 *
 * Read through `import.meta.env` rather than `$env/static/public`, which throws
 * when the variable is unset.
 */
export const LOCAL_MODE: boolean = import.meta.env.PUBLIC_ENABLE_LOCAL_MODE === 'true';
