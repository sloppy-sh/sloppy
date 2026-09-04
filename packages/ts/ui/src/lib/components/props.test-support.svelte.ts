/** Props a test can change after mounting, which a plain `.test.ts` cannot
 *  build: runes compile only in a `.svelte.ts`. */
export function reactive<T extends object>(initial: T): T {
	const held = $state(initial);
	return held;
}
