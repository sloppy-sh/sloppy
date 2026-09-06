<script lang="ts">
	// Somebody a peer surface names: the person where their instance placed them,
	// the identifier they travel by where nobody could.
	import { cn } from '$lib/utils.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import PersonChip from '../identity/person-chip.svelte';
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

	// The letters an identifier ends in, which is what tells two people nobody
	// could place apart at a glance. The identifier itself is drawn beside it.
	const initials = $derived(peer.identity.slice(-2).toUpperCase());
</script>

{#if peer.person}
	<PersonChip person={peer.person} {size} class={className} />
{:else}
	<span class={cn('flex min-w-0 items-center gap-3', className)}>
		{#if peer.unplaced}
			<span
				aria-hidden="true"
				class="flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground"
				style:width="{size}px"
				style:height="{size}px"
				style:font-size="{Math.round(size * 0.38)}px"
			>
				{initials}
			</span>
		{:else}
			<Skeleton class="shrink-0 rounded-full" style="width: {size}px; height: {size}px" />
		{/if}
		<span class="min-w-0 truncate font-mono text-xs select-text">{peer.identity}</span>
	</span>
{/if}
