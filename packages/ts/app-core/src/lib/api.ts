/**
 * The api port. `api` is what every page, component and store talks to, and it
 * resolves its implementation on first property access — so remote ↔ local
 * swaps without touching a call site. docs/ARCHITECTURE.md § "The two files
 * that carry the platform seam".
 */

import { SloppyClient } from '@sloppy/client';
import { runtime } from './runtime.js';

/**
 * The full `SloppyClient` surface, structurally. A remote backend IS the
 * client; the native shell's on-device adapter implements the same shape over
 * the embedded engine, with {@link serverOnly} for what it cannot serve.
 */
export type SloppyApi = SloppyClient;

/** Thrown by an on-device adapter for something that genuinely needs a server. */
export class ServerRequiredError extends Error {
	constructor(feature: string) {
		super(`${feature} needs a server connection`);
		this.name = 'ServerRequiredError';
	}
}

/** A whole method body, for anything an adapter cannot run locally. */
export function serverOnly(feature: string): never {
	throw new ServerRequiredError(feature);
}

export function createRemoteApi(): SloppyApi {
	return new SloppyClient({
		token: () => runtime.token.get(),
		fetch: (...args: Parameters<typeof fetch>) => runtime.fetchImpl()(...args),
		onAuthInvalid: () => runtime.authInvalid()
	});
}

let impl: SloppyApi | null = null;

/** Call after swapping which backend serves the app. Re-pointing at another
 *  host does NOT need this: the client reads the host per request. */
export function resetApi(): void {
	impl = null;
}

export const api: SloppyApi = new Proxy({} as SloppyApi, {
	get(_target, prop) {
		const current = (impl ??= runtime.createApi() ?? createRemoteApi());
		const value = current[prop as keyof SloppyApi];
		return typeof value === 'function' ? value.bind(current) : value;
	}
});
