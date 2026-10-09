/**
 * Which section of a long page the reader is in, for the contents beside it —
 * DESIGN.md § Layout.
 */

/** How far down the window a section has to have come to be the one somebody
 *  is reading: a band across the top, below the chrome and above the fold. */
const BAND = 0.4;

export class SectionsRead {
	#at = $state<string | null>(null);

	/** The section in front of somebody, by its id. */
	get at(): string | null {
		return this.#at;
	}

	/**
	 * Follow the sections with these ids, in the order they stand on the page.
	 * Returns the disposer, so an `$effect` owns it; a window with no observer
	 * follows nothing and leaves the first section marked.
	 */
	follow(ids: readonly string[]): () => void {
		this.#at = ids[0] ?? null;
		if (typeof IntersectionObserver === 'undefined') return () => {};
		// The observer says WHEN to look again; which section it is, is read off
		// the sections themselves, so the answer is the last one to have crossed
		// rather than whichever one moved.
		const mark = (): void => {
			const band = window.innerHeight * BAND;
			for (const id of ids) {
				const section = document.getElementById(id);
				if (section && section.getBoundingClientRect().top <= band) this.#at = id;
			}
		};
		const watch = new IntersectionObserver(mark, {
			rootMargin: `0px 0px -${Math.round((1 - BAND) * 100)}% 0px`
		});
		for (const id of ids) {
			const section = document.getElementById(id);
			if (section) watch.observe(section);
		}
		return () => watch.disconnect();
	}
}

/** Take the reader to a section, and the keyboard with them — the section
 *  itself is what takes focus, so the next tab is inside it. */
export function goToSection(id: string): void {
	const section = document.getElementById(id);
	if (!section) return;
	section.scrollIntoView({ behavior: stillness() ? 'auto' : 'smooth', block: 'start' });
	section.focus({ preventScroll: true });
}

function stillness(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
