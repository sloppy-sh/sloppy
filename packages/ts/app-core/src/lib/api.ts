/**
 * The api port. `api` is what every page, component and store talks to, and it
 * resolves its implementation on first property access — so remote ↔ local
 * swaps without touching a call site. docs/ARCHITECTURE.md § "The two files
 * that carry the platform seam".
 */

import { type SloppyApi, SloppyClient } from '@sloppy/client';
import { runtime } from './runtime.js';

/** A remote backend IS the client; `@sloppy/local`'s `LocalApi` implements the
 *  same shape over a folder on the device, with `serverOnly` for what it
 *  cannot serve. */
export type { SloppyApi } from '@sloppy/client';
export { ServerRequiredError, serverOnly } from '@sloppy/client';

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
