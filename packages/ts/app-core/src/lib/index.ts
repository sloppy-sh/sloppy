// The barrel for @sloppy/app-core. Every module below states its own contract;
// a line here would be a second copy of it.

export { api, createRemoteApi, resetApi, ServerRequiredError, serverOnly } from './api.js';
export type { SloppyApi } from './api.js';
export { initRuntime, runtime, updateRuntime } from './runtime.js';
export type {
	AppRuntime,
	ChatAccess,
	ChatAsked,
	DeploymentMode,
	KnownFolder,
	VaultAccess
} from './runtime.js';
export { keyboard, trackKeyboard } from './keyboard.svelte.js';
export type { KeyboardChange } from './keyboard.svelte.js';
export { deviceStore } from './device-store.js';
export type { DeviceArea } from './device-store.js';
export {
	activeRouteId,
	APP_ROUTES,
	citationUrl,
	isOpenRoute,
	newHref,
	nodeHref,
	OPEN_ROUTES,
	refFromPath
} from './pages/routes.js';

export { serverMessage } from './stores/errors.js';
export { session } from './stores/session.svelte.js';
export {
	ACCENT_LABELS,
	ACCENTS,
	prefs,
	STYLE_LABELS,
	STYLES,
	THEME_LABELS,
	THEMES
} from './stores/prefs.svelte.js';
export type { Accent, Prefs, Style, Theme } from './stores/prefs.svelte.js';
export {
	OPENING_STRENGTH,
	openingWallpaper,
	sanitizeWallpaper,
	sanitizeWallpapers
} from './wallpaper.js';
export type { WallpaperPrefs } from './wallpaper.js';
export { nodes } from './stores/nodes.svelte.js';
export type { NodeRegion, RegionState } from './stores/nodes.svelte.js';
export { graphs, MOST_ON_CANVAS } from './stores/graphs.svelte.js';
export type { GraphsState } from './stores/graphs.svelte.js';
export { tags } from './stores/tags.svelte.js';
export type { TagsState } from './stores/tags.svelte.js';
