import type { NoteMedia, ShownPicture } from '../editor/contract.js';

/**
 * The upload `preview` names, ready for an `<img>`, following it as it changes
 * and releasing what it held. `null` while there is nothing to show and while
 * one is on its way — a picture that will not read leaves the mark drawing as a
 * mark with no picture, which is what one since taken down leaves behind too.
 */
export function shownPicture(
	media: () => NoteMedia,
	preview: () => string | undefined
): { readonly src: string | null } {
	let src = $state<string | null>(null);

	$effect(() => {
		const upload = preview();
		src = null;
		if (upload === undefined) return;
		let held: ShownPicture | null = null;
		let live = true;
		void media()
			.picture(upload)
			.then((shown) => {
				if (!live) {
					shown.release();
					return;
				}
				held = shown;
				src = shown.src;
			})
			.catch(() => undefined);
		return () => {
			live = false;
			held?.release();
		};
	});

	return {
		get src() {
			return src;
		}
	};
}
