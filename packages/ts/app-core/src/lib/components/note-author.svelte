<script lang="ts">
	// Who wrote the note on screen — DESIGN.md § "Show, don't tell".
	import { PersonChip } from '@sloppy/ui';
	import { people } from '../stores/people.svelte.js';

	let { did }: { did: string } = $props();

	const person = $derived(people.of(did));

	$effect(() => {
		people.resolve(did);
	});
</script>

{#if person}
	<PersonChip {person} size={24} handle={false} class="gap-2 text-sm" />
{/if}
