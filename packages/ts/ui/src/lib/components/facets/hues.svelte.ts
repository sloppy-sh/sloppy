// The colour a facet chip is drawn in. `@sloppy/graph` owns the ramp — a chip
// and the node it stands for would otherwise disagree about what a value looks
// like, and the mark floor is measured on the ramp, not on a chip's guess.

import { type GraphPalette, readPalette } from '@sloppy/graph';
import type { FacetSlot } from '@sloppy/types';

let palette = $state<GraphPalette | undefined>(undefined);
let watchers = 0;
let themes: MutationObserver | undefined;

/** Keep the ramp in step with the theme; call from an `$effect` and hand back
 *  what it returns. */
export function watchFacetHues(): () => void {
	if (watchers++ === 0) {
		const root = document.documentElement;
		const read = () => {
			palette = readPalette(root);
		};
		read();
		themes = new MutationObserver(read);
		themes.observe(root, {
			attributes: true,
			attributeFilter: ['data-theme', 'data-accent', 'class']
		});
	}
	return () => {
		if (--watchers > 0) return;
		themes?.disconnect();
		themes = undefined;
	};
}

/** One value's colour: `index` is its place among `count` values on the
 *  dimension's ramp. `undefined` until a theme has been read. */
export function facetHue(slot: FacetSlot, index: number, count: number): string | undefined {
	const read = palette;
	return read && hex(read.facet(slot, index, count));
}

/** What the canvas paints a note the lens has nothing to say about. */
export function unlabelledHue(): string | undefined {
	const read = palette;
	return read && hex(read.unlabelled);
}

function hex(rgb: number): string {
	return `#${rgb.toString(16).padStart(6, '0')}`;
}
