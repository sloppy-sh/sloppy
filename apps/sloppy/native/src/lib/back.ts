import { page } from '$app/state';
import { session } from '@sloppy/app-core';
import { overlay } from '@sloppy/ui';

/** MainActivity.kt offers Android's back press here first and leaves only where
 *  this refuses it. With nobody signed in the frame decides where a person
 *  stands and would put them straight back, so the press leaves rather than
 *  going nowhere. */
export function answerBack(event: Event): void {
	if (overlay.closeTop()) event.preventDefault();
	else if (session.signedIn && page.url.pathname !== '/') {
		event.preventDefault();
		history.back();
	}
}
