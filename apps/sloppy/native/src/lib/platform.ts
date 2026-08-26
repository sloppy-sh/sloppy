/**
 * Compile-time platform branching. The Tauri CLI sets `TAURI_ENV_PLATFORM` for
 * the frontend build ('darwin' | 'windows' | 'linux' | 'android' | 'ios'); a
 * plain `vite dev` in a browser leaves it unset, which reads as desktop.
 *
 * Compile-time is the point: a runtime `if (isIOS)` ships every platform's
 * branch to every platform, and the plugin imports behind these constants would
 * all be bundled. `vite.config.ts` exposes the prefix that makes it work.
 */
export const TAURI_PLATFORM: string =
	(import.meta.env.TAURI_ENV_PLATFORM as string | undefined) ?? 'desktop';

export const IS_MOBILE = TAURI_PLATFORM === 'android' || TAURI_PLATFORM === 'ios';

/** iOS and iPadOS both report 'ios'; macOS reports 'darwin'. */
export const IS_APPLE = TAURI_PLATFORM === 'ios' || TAURI_PLATFORM === 'darwin';
