// What jsdom does not implement but the components use.

/** Answers `query` from `matches`, live: a list handed out earlier re-reads it,
 *  which is what makes {@link MediaQueryStub.change} a real breakpoint crossing. */
export function stubMediaQuery(matches: (query: string) => boolean): MediaQueryStub {
	let current = matches;
	const lists = new Set<EventTarget>();
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => {
			// A real EventTarget, because a listener added through `svelte/events`
			// is called with the event and reads it.
			const list = new EventTarget();
			Object.defineProperties(list, {
				matches: { get: () => current(query) },
				media: { value: query },
				onchange: { value: null, writable: true }
			});
			lists.add(list);
			return list;
		}
	});
	return {
		change(next: (query: string) => boolean) {
			current = next;
			for (const list of lists) list.dispatchEvent(new Event('change'));
		}
	};
}

export interface MediaQueryStub {
	/** A rotation, or a window dragged across a breakpoint. */
	change(next: (query: string) => boolean): void;
}

export function stubResizeObserver(): void {
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}
