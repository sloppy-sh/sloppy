// What jsdom does not implement but the components use.

/** Answers `query` from `matches`, live: a list handed out earlier re-reads it,
 *  which is what makes {@link MediaQueryStub.change} a real breakpoint crossing. */
export function stubMediaQuery(matches: (query: string) => boolean): MediaQueryStub {
	let current = matches;
	const listeners = new Set<() => void>();
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			get matches() {
				return current(query);
			},
			media: query,
			onchange: null,
			addEventListener: (_: string, fn: () => void) => listeners.add(fn),
			removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
			dispatchEvent: () => true
		})
	});
	return {
		change(next: (query: string) => boolean) {
			current = next;
			for (const fn of listeners) fn();
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
