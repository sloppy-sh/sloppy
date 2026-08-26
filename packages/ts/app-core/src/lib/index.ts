// The barrel for @sloppy/app-core. Every module below states its own contract;
// a line here would be a second copy of it.

export { api, createRemoteApi, resetApi, ServerRequiredError, serverOnly } from './api.js';
export type { SloppyApi } from './api.js';
export { initRuntime, runtime } from './runtime.js';
export type { AppRuntime, DeploymentMode } from './runtime.js';
export { keyboard } from './keyboard.svelte.js';
