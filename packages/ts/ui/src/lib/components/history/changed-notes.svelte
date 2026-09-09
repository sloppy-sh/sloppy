<script lang="ts" module>
	import type { BlockDocument } from '@sloppy/types';

	/** One section of a note as two states have it. Absent on a side is a state
	 *  that has no such section at all. */
	export interface ChangedSection {
		ulid: string;
		before?: BlockDocument;
		after?: BlockDocument;
	}

	/** The pictures a difference names, which stand in no note. */
	export interface ChangedPictures {
		added: number;
		removed: number;
	}

	/** A note a difference names, as the list shows it. Every label here is
	 *  already what a person calls the thing — a note's address or its title,
	 *  never a ref. */
	export interface ChangedNote {
		ref: string;
		title: string;
		address?: string;
		became: 'added' | 'removed' | 'kept';
		/** What it sprang from on each side; absent on a side is nothing at all —
		 *  a branch, or a note on its own. Absent altogether is a note that stayed
		 *  where it was. */
		moved?: { from?: string; to?: string };
		retitled?: { from: string };
		renumbered?: { from?: string; to?: string };
		/** The sections it kept, standing in another order. */
		reordered: boolean;
		sections: ChangedSection[];
	}
</script>

<script lang="ts">
	// What a person did between two states of their graph, note by note and
	// section by section — DESIGN.md § "A difference between two states": the
	// mark says a note is not as it was, and this says how.
	import { sectionDifference, sectionLines } from '../publish/section-text.js';

	let {
		notes,
		pictures,
		nothing = 'Nothing has changed.'
	}: {
		notes: readonly ChangedNote[];
		pictures?: ChangedPictures;
		/** What to say where the difference names nothing. */
		nothing?: string;
	} = $props();

	function ofPictures(many: number, became: string): string | null {
		if (many === 0) return null;
		return many === 1 ? `A picture ${became}.` : `${many} pictures ${became}.`;
	}

	const aboutPictures = $derived(
		[
			ofPictures(pictures?.added ?? 0, 'arrived'),
			ofPictures(pictures?.removed ?? 0, 'went')
		].filter((line): line is string => line !== null)
	);

	const BECAME: Record<ChangedNote['became'], string> = {
		added: 'New note',
		removed: 'Taken out',
		kept: 'Edited'
	};

	function became(note: ChangedNote): string {
		if (note.became !== 'kept') return BECAME[note.became];
		if (note.sections.length > 0 || note.reordered) return BECAME.kept;
		if (note.moved) return 'Moved';
		if (note.renumbered) return 'Renumbered';
		return 'Renamed';
	}

	type Drawn =
		| { both: true; was: BlockDocument; now: BlockDocument }
		| { both: false; said: string; content: BlockDocument; gone: boolean };

	function drawn(section: ChangedSection): Drawn | null {
		const { before, after } = section;
		if (before && !after) return { both: false, said: 'Taken out', content: before, gone: true };
		if (after && !before) return { both: false, said: 'Added', content: after, gone: false };
		if (!before || !after) return null;
		const apart = sectionDifference({ ord: '', content: before }, { ord: '', content: after });
		return apart === 'rewritten'
			? { both: true, was: before, now: after }
			: { both: false, said: 'Edited', content: after, gone: false };
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

{#each aboutPictures as line (line)}
	<p class="px-1 py-1 text-sm text-muted-foreground">{line}</p>
{/each}

{#if notes.length > 0}
	<ul class="space-y-6">
		{#each notes as note (note.ref)}
			<li class="space-y-2">
				<div class="flex items-baseline gap-2">
					{#if note.address}
						<span class="shrink-0 address text-sm">{note.address}</span>
					{/if}
					<span class="min-w-0 flex-1 truncate text-sm">{note.title || 'Untitled'}</span>
					<span class="shrink-0 text-xs text-muted-foreground">{became(note)}</span>
				</div>

				{#if note.renumbered?.from}
					<p class="text-xs text-muted-foreground">
						Was at <span class="address">{note.renumbered.from}</span>
					</p>
				{:else if note.renumbered?.to}
					<p class="text-xs text-muted-foreground">Had no number</p>
				{/if}
				{#if note.retitled}
					<p class="text-xs text-muted-foreground">Was “{note.retitled.from || 'Untitled'}”</p>
				{/if}
				{#if note.moved}
					<p class="text-xs text-muted-foreground">
						{#if note.moved.to}
							Now springs from {note.moved.to}
						{:else}
							Springs from nothing now
						{/if}
						{#if note.moved.from}
							· was under {note.moved.from}
						{/if}
					</p>
				{/if}
				{#if note.reordered}
					<p class="text-xs text-muted-foreground">Its sections stand in another order</p>
				{/if}

				{#each note.sections as section (section.ulid)}
					{@const shown = drawn(section)}
					{#if shown}
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
					{/if}
				{/each}
			</li>
		{/each}
	</ul>
{:else if aboutPictures.length === 0}
	<p class="px-1 py-2 text-sm text-muted-foreground">{nothing}</p>
{/if}
