/**
 * Compile-time platform branching — docs/ARCHITECTURE.md § "The two files that
 * carry the platform seam".
 *
 * The Tauri CLI sets `TAURI_ENV_PLATFORM` for the frontend build
 * ('darwin' | 'windows' | 'linux' | 'android' | 'ios'); a plain `vite dev` in a
 * browser leaves it unset, which reads as desktop.
 */
export const TAURI_PLATFORM: string = import.meta.env.TAURI_ENV_PLATFORM ?? 'desktop';

export const IS_MOBILE = TAURI_PLATFORM === 'android' || TAURI_PLATFORM === 'ios';

/** iOS and iPadOS both report 'ios'; macOS reports 'darwin'. */
export const IS_APPLE = TAURI_PLATFORM === 'ios' || TAURI_PLATFORM === 'darwin';
