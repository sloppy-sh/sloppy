import { SvelteMap } from 'svelte/reactivity';
import type { NoteMedia, ShownPicture } from '../editor/contract.js';

/**
 * The uploads a series names, ready for an `<img>` — following the series as it
 * is added to and taken from, and releasing whatever leaves it.
 *
 * A picture that will not read is simply absent, which is what a mark showing
 * one since taken down draws too: nothing, rather than a gap.
 */
export function shownPictures(
	media: () => NoteMedia,
	pictures: () => readonly string[]
): { of(upload: string | undefined): string | null } {
	const srcs = new SvelteMap<string, string>();
	/** Held or on its way, so one already asked for is not asked for twice. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders off this, and the effect that reads it also writes it: a tracked read would ask for every picture again on every answer.
	const held = new Map<string, ShownPicture | null>();

	function drop(upload: string): void {
		held.get(upload)?.release();
		held.delete(upload);
		srcs.delete(upload);
	}

	$effect(() => {
		const wanted = pictures();
		const store = media();
		for (const upload of [...held.keys()]) {
			if (!wanted.includes(upload)) drop(upload);
		}
		for (const upload of wanted) {
			if (held.has(upload)) continue;
			held.set(upload, null);
			void store
				.picture(upload)
				.then((shown) => {
					// Taken back off, or already answered by an earlier ask for it.
					if (held.get(upload) !== null) {
						shown.release();
						return;
					}
					held.set(upload, shown);
					srcs.set(upload, shown.src);
				})
				.catch(() => undefined);
		}
	});

	$effect(() => () => {
		for (const upload of [...held.keys()]) drop(upload);
	});

	return {
		of: (upload) => (upload === undefined ? null : (srcs.get(upload) ?? null))
	};
}
