/**
 * Who is signed in, for as long as this tab is open. The credential itself is
 * the runtime's — `AppRuntime.token` in `@sloppy/app-core` — and on web it is
 * usually the API's own cookie, which never reaches this code at all.
 */

import { api, runtime } from '@sloppy/app-core';
import type { Viewer } from '@sloppy/types';
import { isSignedOut, reason } from './errors.js';

class SessionStore {
	viewer = $state<Viewer | null>(null);
	loaded = $state(false);
	/** Set when the answer is unknown rather than "nobody" — a surface that
	 *  offers to sign in has to say which of the two it is looking at. */
	unreachable = $state<string | null>(null);

	async load(): Promise<void> {
		try {
			this.viewer = await api.me();
			this.unreachable = null;
		} catch (error) {
			this.viewer = null;
			this.unreachable = isSignedOut(error)
				? null
				: reason(error, 'Sloppy is not answering right now. Try again in a moment.');
		} finally {
			this.loaded = true;
		}
	}

	async signOut(): Promise<void> {
		try {
			await api.signOut();
		} catch {
			// Nothing here is worth retrying: this browser is signed out either way.
		}
		this.forget();
	}

	/** The credential is spent — because it was surrendered, or refused. */
	forget(): void {
		runtime.token.clear();
		this.viewer = null;
		this.unreachable = null;
		this.loaded = true;
	}
}

export const session = new SessionStore();
