<script lang="ts">
	// The find surface under a caller that answers on its own clock, which is
	// what a page looking through its notes is: one answer is in flight at a
	// time, and it lands carrying the word the keystroke it started on typed.
	import type { OwnedRef } from '@sloppy/types';
	import { tick } from 'svelte';
	import FindSheet, { type FoundNote } from './find-sheet.svelte';

	let {
		onsaid,
		answersAfter = 0
	}: {
		/** Called with every word the surface reports, as it reports it. */
		onsaid: (words: string) => void;
		/** How many draws the caller takes to carry a word back. */
		answersAfter?: number;
	} = $props();

	let open = $state(true);
	let query = $state('');
	let found = $state<FoundNote[]>([]);
	let asking: string | null = null;

	async function say(words: string): Promise<void> {
		onsaid(words);
		if (asking !== null) return;
		asking = words;
		for (let draw = 0; draw < answersAfter; draw += 1) await tick();
		query = asking;
		asking = null;
		found = [];
	}
</script>

<FindSheet
	bind:open
	{query}
	{found}
	onquery={(words) => void say(words)}
	onopen={(ref: OwnedRef) => void ref}
/>
