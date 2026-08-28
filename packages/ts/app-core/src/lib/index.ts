// The barrel for @sloppy/app-core. Every module below states its own contract;
// a line here would be a second copy of it.

export { api, createRemoteApi, resetApi, ServerRequiredError, serverOnly } from './api.js';
export type { SloppyApi } from './api.js';
export { initRuntime, runtime } from './runtime.js';
export type { AppRuntime, DeploymentMode } from './runtime.js';
export { keyboard } from './keyboard.svelte.js';
export { activeRouteId, APP_ROUTES, nodeHref, OPEN_ROUTES, refFromPath } from './pages/routes.js';

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
export { nodes } from './stores/nodes.svelte.js';
export type { NodeRegion, RegionState } from './stores/nodes.svelte.js';
export { tags } from './stores/tags.svelte.js';
