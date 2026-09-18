<script lang="ts">
	// Where an offer would have the note point, slot by slot — DESIGN.md
	// § "The compass card".
	import { noteLabel, type OwnedRef } from '@sloppy/types';
	import { COMPASS_WORDS } from '@sloppy/ui';
	import { nodes } from '../stores/nodes.svelte.js';
	import type { CompassApart } from './offer-difference.js';

	let { apart }: { apart: readonly CompassApart[] } = $props();

	$effect(() => {
		for (const slot of apart) {
			for (const ref of [...slot.gained, ...slot.lost]) {
				if (!nodes.get(ref)) void nodes.fetch(ref).catch(() => {});
			}
		}
	});

	function named(refs: readonly OwnedRef[]): string {
		return refs
			.map((ref) => {
				const note = nodes.get(ref);
				return note ? note.title.trim() || noteLabel(note) : 'a note';
			})
			.join(', ');
	}
</script>

{#if apart.length > 0}
	<ul class="space-y-0.5 px-1 text-sm">
		{#each apart as slot (slot.direction)}
			<li>
				<span class="text-muted-foreground">{COMPASS_WORDS[slot.direction].word}:</span>
				{#if slot.gained.length > 0}gained {named(slot.gained)}{/if}
				{#if slot.gained.length > 0 && slot.lost.length > 0}&nbsp;·&nbsp;{/if}
				{#if slot.lost.length > 0}no longer {named(slot.lost)}{/if}
			</li>
		{/each}
	</ul>
{/if}
