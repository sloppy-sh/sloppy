<script lang="ts">
	// What a branch has done since it was last published, read at the decision to
	// publish it again — PRODUCT.md § "Design Principles" 5.
	import type { UnpublishedChange } from '@sloppy/types';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';

	let {
		changes,
		total
	}: {
		changes: readonly UnpublishedChange[];
		total: number;
	} = $props();

	const BECAME: Record<UnpublishedChange['change'], string> = {
		added: 'New note',
		removed: 'Taken out',
		changed: 'Edited'
	};

	function onlyCarried(entry: UnpublishedChange): boolean {
		return (
			entry.was_at !== undefined &&
			entry.was_titled === undefined &&
			entry.tags_gained.length === 0 &&
			entry.tags_lost.length === 0
		);
	}

	function became(entry: UnpublishedChange): string {
		if (entry.change !== 'changed') return BECAME[entry.change];
		if (entry.written) return 'Written in';
		return onlyCarried(entry) ? 'Moved' : BECAME.changed;
	}
</script>

<ul class="max-h-56 space-y-2 overflow-y-auto scroll-fade-y" {@attach scrollFade('y')}>
	{#each changes as entry (entry.note)}
		<li class="space-y-0.5">
			<div class="flex items-baseline gap-2">
				<span class="shrink-0 address text-sm">{entry.address}</span>
				<span class="min-w-0 flex-1 truncate text-sm">{entry.title || 'Untitled'}</span>
				<span class="shrink-0 text-xs text-muted-foreground">{became(entry)}</span>
			</div>
			{#if entry.was_at !== undefined}
				<p class="text-xs text-muted-foreground">
					Was at <span class="address">{entry.was_at}</span>
				</p>
			{/if}
			{#if entry.was_titled !== undefined}
				<p class="text-xs text-muted-foreground">Was “{entry.was_titled || 'Untitled'}”</p>
			{/if}
			{#if entry.tags_gained.length > 0}
				<p class="text-xs text-muted-foreground">Now tagged {entry.tags_gained.join(', ')}</p>
			{/if}
			{#if entry.tags_lost.length > 0}
				<p class="text-xs text-muted-foreground">
					No longer tagged {entry.tags_lost.join(', ')}
				</p>
			{/if}
		</li>
	{/each}
</ul>

{#if total > changes.length}
	<p class="text-sm text-muted-foreground">
		And {total - changes.length} more.
	</p>
{/if}
