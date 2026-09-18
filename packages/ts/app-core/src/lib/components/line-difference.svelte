<script lang="ts">
	// How an offer would draw the note's lines, line by line — DESIGN.md § Edges,
	// "A look a person set".
	import { noteLabel, type OwnedRef } from '@sloppy/types';
	import { nodes } from '../stores/nodes.svelte.js';
	import { lookInWords, type LookApart } from './offer-difference.js';

	let { apart }: { apart: readonly LookApart[] } = $props();

	$effect(() => {
		for (const line of apart) {
			if (!nodes.get(line.to)) void nodes.fetch(line.to).catch(() => {});
		}
	});

	function named(ref: OwnedRef): string {
		const note = nodes.get(ref);
		return note ? note.title.trim() || noteLabel(note) : 'a note';
	}
</script>

{#if apart.length > 0}
	<ul class="space-y-0.5 px-1 text-sm">
		{#each apart as line (line.to)}
			<li class="break-words">
				<span class="text-muted-foreground">Line to {named(line.to)}:</span>
				{lookInWords(line.look)}
			</li>
		{/each}
	</ul>
{/if}
