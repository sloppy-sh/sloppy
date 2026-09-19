import { page } from '$app/state';
import { session } from '@sloppy/app-core';
import { overlay } from '@sloppy/ui';

/** MainActivity.kt offers Android's back press here first and leaves only where
 *  this refuses it. */
export function answerBack(event: Event): void {
	if (overlay.closeTop()) event.preventDefault();
	else if (somewhereBack()) {
		event.preventDefault();
		history.back();
	}
}

/** Settings is the one page a person reaches from inside the app before they
 *  sign in, so the press walks back to where they came from. Anywhere else with
 *  nobody signed in the frame decides where they stand and would put them
 *  straight back, so the press leaves rather than going nowhere. */
function somewhereBack(): boolean {
	const path = page.url.pathname;
	if (path === '/') return false;
	return session.signedIn || path === '/settings';
}
