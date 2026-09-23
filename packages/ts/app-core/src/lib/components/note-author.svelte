<script lang="ts">
	// Whose writing the note on screen carries, and the way to meet them —
	// DESIGN.md § "Whose writing" and § "Show, don't tell".
	import { authorsOf, type NodeView } from '@sloppy/types';
	import { PersonChip, unnamedPerson } from '@sloppy/ui';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import PersonSurface from './person-surface.svelte';

	let { note }: { note: Pick<NodeView, 'created_by' | 'authors' | 'contributors'> } = $props();

	let meeting = $state<string | null>(null);

	/** Null until their instance has answered one way or the other. */
	function shown(did: string) {
		const person = people.of(did);
		return person ?? (people.unplaced(did) ? unnamedPerson(did) : null);
	}

	const wrote = $derived(authorsOf(note).filter((did) => shown(did) !== null));
	const helped = $derived((note.contributors ?? []).filter((did) => shown(did) !== null));
	/** One person who wrote their own note is the ordinary case, and reads as it
	 *  always has. */
	const named = $derived(wrote.length > 1 || helped.length > 0);

	$effect(() => {
		for (const did of [...authorsOf(note), ...(note.contributors ?? [])]) people.resolve(did);
	});
</script>

{#snippet person(did: string)}
	{@const who = shown(did)}
	{#if who && did === session.viewer?.did}
		<PersonChip person={who} size={24} handle={false} class="gap-2 text-sm" />
	{:else if who}
		<button
			type="button"
			class="-mx-1 flex min-h-9 min-w-0 items-center rounded-md px-1 transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
			onclick={() => (meeting = did)}
		>
			<PersonChip person={who} size={24} handle={false} class="gap-2 text-sm" />
		</button>
	{/if}
{/snippet}

{#snippet chain(dids: string[], last: string | null)}
	{#each dids as did, at (did)}
		{@const after = at < dids.length - 1 ? (at === dids.length - 2 ? 'and' : '·') : last}
		{#if after === null}
			{@render person(did)}
		{:else}
			<!-- Every separator rides the name it follows, so a line that wraps here
			     begins with a name and never with the word joining two. -->
			<span class="flex min-w-0 items-center gap-x-1.5">
				{@render person(did)}
				<span class="text-sm text-muted-foreground">{after}</span>
			</span>
		{/if}
	{/each}
{/snippet}

{#if wrote.length > 0}
	<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
		{#if named}
			<span class="text-sm text-muted-foreground">Written by</span>
		{/if}
		{@render chain(wrote, helped.length > 0 ? '·' : null)}
		{#if helped.length > 0}
			<span class="text-sm text-muted-foreground">with</span>
			{@render chain(helped, null)}
		{/if}
	</div>

	<PersonSurface bind:did={meeting} />
{/if}
