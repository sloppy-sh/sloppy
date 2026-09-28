/**
 * What the page standing now puts in the desk sidebar, beside the destinations
 * the shell draws — DESIGN.md § Layout. One writer, the way `dock-stack` has
 * one writer for the width the right-hand docks owe.
 */

import type { Snippet } from 'svelte';
import { DOCK_FROM_PX } from './side-dock.svelte';

/** From here up the chrome stands beside the graph rather than over it — the
 *  same width the docks answer. */
export const DESK_FROM_PX = DOCK_FROM_PX;

/** Handed the sidebar's own state, so a page draws icons in an icon rail and
 *  the whole of itself in an open one. */
export type DeskParts = Snippet<[{ collapsed: boolean }]>;

class DeskNavState {
	#parts = $state<DeskParts | null>(null);

	get parts(): DeskParts | null {
		return this.#parts;
	}

	/** Returns the disposer that takes them away again; calling it twice is a
	 *  no-op, so an `$effect` cleanup can own it. */
	fills(parts: DeskParts): () => void {
		this.#parts = parts;
		return () => {
			if (this.#parts === parts) this.#parts = null;
		};
	}
}

export const deskNav = new DeskNavState();
