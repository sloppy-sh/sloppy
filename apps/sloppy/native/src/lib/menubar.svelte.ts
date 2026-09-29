/**
 * The app's own menu bar on a desk: what it says is `menu.ts` in
 * `@sloppy/app-core`, and this carries that across and carries back the id of
 * whatever was chosen. Nothing here knows what a line means.
 */

import { acts, appMenu } from '@sloppy/app-core';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Invoke } from './files';

const SET = 'app_menu_set';
const CHOSEN = 'menu';

/** Keeps the menu as the page's acts change, and does what is chosen from it.
 *  Returns the disposer. */
export function wireMenu(call: Invoke = invoke): () => void {
	const stop = $effect.root(() => {
		$effect(() => {
			void call(SET, { groups: appMenu() }).catch(() => {});
		});
	});
	// Nothing outside the app carries a menu, so a listener that never comes is
	// this shell running somewhere there is no menu bar to hear from.
	const heard: Promise<UnlistenFn | undefined> = listen<string>(CHOSEN, (event) =>
		acts.run(event.payload)
	).catch(() => undefined);
	return () => {
		stop();
		void heard.then((off) => off?.());
	};
}
