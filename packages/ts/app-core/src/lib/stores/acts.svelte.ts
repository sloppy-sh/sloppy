/**
 * What the page standing now can do, declared once and read by every surface
 * that offers it — the palette, the column beside the graph, the "More" over
 * the canvas, the app's own menu bar — DESIGN.md § Layout. One writer, the
 * way `deskNav` in `@sloppy/ui` has one for the column's parts.
 */

import type { Component } from 'svelte';
import type { Accelerator } from '../pages/shortcuts.js';

/** Where an act stands: typed for in the palette, a row of the column, an
 *  item behind "More" on a phone, an item of the menu bar. */
export type ActWhere = 'palette' | 'column' | 'more' | 'menu';

export interface Act {
	/** Stable across draws; what the menu bar and the palette run it by. */
	id: string;
	/** The one place the words live. */
	label: string;
	icon?: Component;
	says?: Accelerator;
	/** What it is grouped under where a surface groups. */
	group: string;
	where: readonly ActWhere[];
	run: () => void;
}

class ActsOffered {
	#all = $state.raw<readonly Act[]>([]);

	get all(): readonly Act[] {
		return this.#all;
	}

	get inColumn(): readonly Act[] {
		return this.#all.filter((act) => act.where.includes('column'));
	}

	get inMore(): readonly Act[] {
		return this.#all.filter((act) => act.where.includes('more'));
	}

	get inMenu(): readonly Act[] {
		return this.#all.filter((act) => act.where.includes('menu'));
	}

	get inPalette(): readonly Act[] {
		return this.#all.filter((act) => act.where.includes('palette'));
	}

	/** Returns the disposer that takes them away again; calling it twice is a
	 *  no-op, so an `$effect` cleanup can own it. */
	offers(list: readonly Act[]): () => void {
		this.#all = list;
		return () => {
			if (this.#all === list) this.#all = [];
		};
	}

	/** Do the act by its id; an id nothing offers does nothing. */
	run(id: string): void {
		this.#all.find((act) => act.id === id)?.run();
	}
}

export const acts = new ActsOffered();
