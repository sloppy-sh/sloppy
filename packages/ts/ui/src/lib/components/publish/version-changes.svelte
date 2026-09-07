<script lang="ts" module>
	import type { PublishedNoteChange } from '@sloppy/types';

	/** The difference between two versions, as far as a surface has read it. */
	export interface VersionComparison {
		changes: readonly PublishedNoteChange[];
		/** More to ask for; absent is the end of it. */
		nextCursor?: string;
	}
</script>

<script lang="ts">
	// What one publish did to a branch, read the way a person reads a review:
	// note by note, in address order, with the writing either side of it.
	import type { BlockDocument, PublishedSectionChange } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { sectionDifference, sectionLines } from './section-text.js';

	let {
		changes,
		nextCursor = undefined,
		busy = false,
		onmore
	}: {
		changes: readonly PublishedNoteChange[];
		nextCursor?: string;
		busy?: boolean;
		onmore: (cursor: string) => void;
	} = $props();

	const BECAME: Record<PublishedNoteChange['change'], string> = {
		added: 'New note',
		removed: 'Taken out',
		changed: 'Edited'
	};

	function sectionsOf(entry: PublishedNoteChange): readonly PublishedSectionChange[] {
		return entry.change === 'removed' ? [] : entry.sections;
	}

	function gained(entry: PublishedNoteChange): string[] {
		if (entry.change !== 'changed') return [];
		return entry.note.tags.filter((tag) => !entry.before.tags.includes(tag));
	}

	function lost(entry: PublishedNoteChange): string[] {
		if (entry.change !== 'changed') return [];
		return entry.before.tags.filter((tag) => !entry.note.tags.includes(tag));
	}

	function moved(entry: PublishedNoteChange): string | null {
		if (entry.change !== 'changed' || entry.before.address === entry.note.address) return null;
		return entry.before.address;
	}

	function renamed(entry: PublishedNoteChange): string | null {
		if (entry.change !== 'changed' || entry.before.title === entry.note.title) return null;
		return entry.before.title || 'Untitled';
	}

	/**
	 * One section as it can be drawn. Both sides only where they read
	 * differently: a section that was reordered, or one whose difference is a
	 * picture swapped, has the same writing either way, and a was/now pair around
	 * identical lines shows a difference that is not there.
	 */
	type Drawn =
		| { both: true; was: BlockDocument; now: BlockDocument }
		| { both: false; said: string; content: BlockDocument; gone: boolean };

	function drawn(section: PublishedSectionChange): Drawn {
		if (section.change !== 'changed') {
			return {
				both: false,
				said: section.change === 'added' ? 'Added' : 'Taken out',
				content: section.section.content,
				gone: section.change === 'removed'
			};
		}
		const apart = sectionDifference(section.before, section.section);
		if (apart === 'rewritten') {
			return { both: true, was: section.before.content, now: section.section.content };
		}
		return {
			both: false,
			said: apart === 'moved' ? 'Moved' : 'Edited',
			content: section.section.content,
			gone: false
		};
	}
</script>

{#snippet writing(content: BlockDocument, gone: boolean)}
	{@const written = sectionLines(content)}
	{#if written.length === 0}
		<p class="text-sm text-muted-foreground">Nothing written in it.</p>
	{:else}
		{#each written as line, at (at)}
			<p class="text-sm break-words {gone ? 'text-muted-foreground' : ''}">{line}</p>
		{/each}
	{/if}
{/snippet}

{#if changes.length === 0}
	<p class="px-1 py-2 text-sm text-muted-foreground">Nothing in it moved.</p>
{:else}
	<ul class="space-y-6">
		{#each changes as entry (entry.note.ref)}
			{@const was = renamed(entry)}
			{@const from = moved(entry)}
			{@const more = gained(entry)}
			{@const fewer = lost(entry)}
			<li class="space-y-2">
				<div class="flex items-baseline gap-2">
					<span class="shrink-0 address text-sm">{entry.note.address}</span>
					<span class="min-w-0 flex-1 truncate text-sm">{entry.note.title || 'Untitled'}</span>
					<span class="shrink-0 text-xs text-muted-foreground">{BECAME[entry.change]}</span>
				</div>

				{#if from !== null}
					<p class="text-xs text-muted-foreground">Was at <span class="address">{from}</span></p>
				{/if}
				{#if was !== null}
					<p class="text-xs text-muted-foreground">Was “{was}”</p>
				{/if}
				{#if more.length > 0}
					<p class="text-xs text-muted-foreground">Now tagged {more.join(', ')}</p>
				{/if}
				{#if fewer.length > 0}
					<p class="text-xs text-muted-foreground">No longer tagged {fewer.join(', ')}</p>
				{/if}

				{#each sectionsOf(entry) as section (section.section.ref)}
					{@const shown = drawn(section)}
					<div class="space-y-1 border-l-2 border-border pl-3">
						{#if shown.both}
							<p class="text-xs text-muted-foreground">was</p>
							{@render writing(shown.was, true)}
							<p class="pt-1 text-xs text-muted-foreground">now</p>
							{@render writing(shown.now, false)}
						{:else}
							<p class="text-xs text-muted-foreground">{shown.said}</p>
							{@render writing(shown.content, shown.gone)}
						{/if}
					</div>
				{/each}
			</li>
		{/each}
	</ul>

	{#if nextCursor !== undefined}
		<Button
			variant="ghost"
			class="mt-4 h-9 w-full rounded-full"
			disabled={busy}
			onclick={() => onmore(nextCursor)}
		>
			Show more
		</Button>
	{/if}
{/if}
