<script lang="ts">
	// Who wrote the note on screen, and the way to meet them — DESIGN.md
	// § "Show, don't tell".
	import { PersonChip, unplacedPerson } from '@sloppy/ui';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import PersonSurface from './person-surface.svelte';

	let { did }: { did: string } = $props();

	let meeting = $state<string | null>(null);

	const person = $derived(people.of(did));
	/** Null until their instance has answered one way or the other. */
	const shown = $derived(person ?? (people.unplaced(did) ? unplacedPerson(did) : null));
	const mine = $derived(did === session.viewer?.did);

	$effect(() => {
		people.resolve(did);
	});
</script>

{#if shown && mine}
	<PersonChip person={shown} size={24} handle={false} class="gap-2 text-sm" />
{:else if shown}
	<button
		type="button"
		class="-mx-1 flex min-h-9 min-w-0 items-center rounded-md px-1 transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		onclick={() => (meeting = did)}
	>
		<PersonChip person={shown} size={24} handle={false} class="gap-2 text-sm" />
	</button>

	<PersonSurface bind:did={meeting} />
{/if}
