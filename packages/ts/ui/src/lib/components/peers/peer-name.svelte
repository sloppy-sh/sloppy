<script lang="ts">
	// Somebody a peer surface names: the person where their instance placed them,
	// somebody unnamed with their identity beneath where nobody could.
	import { cn } from '$lib/utils.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import PersonChip from '../identity/person-chip.svelte';
	import { unnamedPerson } from '../identity/person.js';
	import type { Peer } from './peer.js';

	let {
		peer,
		size = 32,
		class: className
	}: {
		peer: Peer;
		size?: number;
		class?: string;
	} = $props();
</script>

{#if peer.person}
	<PersonChip person={peer.person} {size} class={className} />
{:else if peer.unplaced}
	<PersonChip person={unnamedPerson(peer.identity)} {size} class={className} />
{:else}
	<span class={cn('flex min-w-0 items-center gap-3', className)}>
		<Skeleton class="shrink-0 rounded-full" style="width: {size}px; height: {size}px" />
		<span class="min-w-0 truncate font-mono text-xs select-text">{peer.identity}</span>
	</span>
{/if}
