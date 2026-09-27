<script lang="ts">
	// Reading a draft of the notes whole, and taking it in with one act —
	// DESIGN.md § "Reading a draft". It stands where the chat stands: on a phone
	// the review IS the panel, and beside the graph it is that same dock given
	// room, with the canvas behind it drawing the two states against each other.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { ImportResolution, OwnedRef } from '@sloppy/types';
	import { HeldStack, ReadingPanel, SettleImport, type ReferenceReader } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import {
		conflictHeading,
		DISCARD_COSTS,
		DRAFT_BAND_HEADINGS,
		DRAFT_BANDS,
		draftHeading,
		draftRows,
		picturesSaid,
		sectionsDrafted,
		settlingSaid,
		type DraftBand
	} from '../draft-said.js';
	import { noteEmoji } from '../note-surface.js';
	import { chatDraft, type DraftedNote, type DraftSide } from '../stores/chat-draft.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import ChatCard from './chat-card.svelte';

	let {
		onBack,
		onDone
	}: {
		/** Back to the conversation, with the draft left standing. */
		onBack: () => void;
		/** The draft is gone — taken in, or thrown away. */
		onDone: () => void;
	} = $props();

	/** What a row opens to for a note one side does not hold. */
	const BINNED = 'The draft puts this note in the bin.';
	const NOT_YOURS_YET = 'Your folder has no such note yet.';
	const UNWRITTEN = 'Nothing written in it.';
	const NO_DRAFT = 'There is no draft to read.';

	const SIDES: { side: DraftSide; named: string }[] = [
		{ side: 'draft', named: 'In the draft' },
		{ side: 'folder', named: 'In your folder' }
	];

	const read = $derived(chatDraft.read);
	const counts = $derived(chatDraft.counts);
	const conflicts = $derived(read?.conflicts ?? []);
	const rows = $derived(read ? draftRows(read.difference, read.conflicts, read.named) : []);
	const pictures = $derived(counts ? picturesSaid(counts) : null);
	const emoji = $derived(noteEmoji(session.viewer?.did ?? '').catalog);

	let settled = $state.raw<readonly ImportResolution[]>([]);
	const unsettled = $derived(conflicts.length - settled.length);

	/** The note a row opened, on the side it is being read from. */
	let opened = $state.raw<{
		ref: OwnedRef;
		side: DraftSide;
		note: DraftedNote | null;
		reading: boolean;
	} | null>(null);

	const openedName = $derived(opened ? draftHeading(read?.named.get(opened.ref)) : 'A note');

	/** Which of its sections the draft wrote, so the one a reader is looking for
	 *  is marked rather than hunted for. */
	const drafted = $derived(
		opened && read && opened.side === 'draft'
			? sectionsDrafted(read.difference, opened.ref, opened.note?.sections ?? [])
			: new Set<OwnedRef>()
	);

	/** A reference inside the note leads to that note on the side it was read
	 *  from, because that is the copy the reader is looking at. */
	const references: ReferenceReader = {
		read: async (note) => (await chatDraft.asRead(opened?.side ?? 'draft', note))?.note ?? null,
		open: (note) => void openRow(note, opened?.side ?? 'draft')
	};

	function inBand(band: DraftBand) {
		return rows.filter((one) => one.band === band);
	}

	async function openRow(ref: OwnedRef, side: DraftSide): Promise<void> {
		opened = { ref, side, note: null, reading: true };
		const asked = opened;
		const note = await chatDraft.asRead(side, ref);
		if (opened === asked) opened = { ref, side, note, reading: false };
	}

	async function take(): Promise<void> {
		if (await chatDraft.merge({ resolutions: [...settled] })) onDone();
	}

	async function throwAway(): Promise<void> {
		if (await chatDraft.discard()) onDone();
	}
</script>

{#snippet band(heading: string, held: ReturnType<typeof inBand>)}
	<section class="space-y-2">
		<h3 class="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
			{heading}
		</h3>
		<ul class="space-y-2">
			{#each held as row (row.ref)}
				<li>
					<button
						type="button"
						class="w-full rounded-lg text-left"
						onclick={() => void openRow(row.ref, row.band === 'removed' ? 'folder' : 'draft')}
					>
						<ChatCard card={row.card} />
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3 pt-2">
	<div class="flex shrink-0 items-center gap-2">
		<Button variant="ghost" class="size-9 shrink-0" aria-label="Back to the chat" onclick={onBack}>
			<ChevronLeft class="size-4" />
		</Button>
		<h2 class="min-w-0 flex-1 truncate text-sm font-medium">The draft</h2>
	</div>

	<div class="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto">
		{#if chatDraft.reading}
			<Skeleton class="h-24 w-full" />
		{:else if !read}
			<p class="px-1 text-sm text-muted-foreground">{NO_DRAFT}</p>
		{:else if read.nothing}
			<p class="px-1 text-sm text-muted-foreground">
				Nothing in your notes is different, so there is nothing to merge.
			</p>
		{:else}
			{#if conflicts.length > 0}
				<div class="space-y-3">
					{@render band(DRAFT_BAND_HEADINGS.settle, inBand('settle'))}
					<p class="px-1 text-sm text-muted-foreground">
						{conflicts.length === 1
							? 'One note was written in on both sides. Choose what it says, and everything else comes in around it.'
							: `${conflicts.length.toLocaleString()} notes were written in on both sides. Choose what each says, and everything else comes in around them.`}
					</p>
					<div class="px-1">
						<SettleImport
							{conflicts}
							otherIs="the draft"
							heading={(one) => conflictHeading(one, read.named)}
							about={settlingSaid}
							busy={chatDraft.busy}
							onchange={(chosen) => (settled = chosen)}
						/>
					</div>
				</div>
			{/if}

			{#each DRAFT_BANDS.filter((one) => one !== 'settle') as one (one)}
				{@const held = inBand(one)}
				{#if held.length > 0}
					{@render band(DRAFT_BAND_HEADINGS[one], held)}
				{/if}
			{/each}

			{#if pictures}
				<p class="px-1 text-sm text-muted-foreground">{pictures}</p>
			{/if}
		{/if}

		{#if chatDraft.says}
			<p class="px-1 text-sm text-destructive" role="alert">{chatDraft.says}</p>
		{/if}
	</div>

	<div class="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
		{#if read && !read.nothing}
			<Button
				class="h-11 w-full"
				disabled={chatDraft.busy || chatDraft.reading || unsettled > 0}
				onclick={() => void take()}
			>
				Merge
			</Button>
			{#if unsettled > 0}
				<p class="px-1 text-xs text-muted-foreground">
					{unsettled === 1
						? 'One note is still to settle.'
						: `${unsettled.toLocaleString()} notes are still to settle.`}
				</p>
			{/if}
		{/if}
		<Button
			variant="ghost"
			class="h-11 w-full"
			disabled={chatDraft.busy}
			onclick={() => void throwAway()}
		>
			Discard
		</Button>
		<p class="px-1 text-xs text-muted-foreground">{DISCARD_COSTS}</p>
	</div>
</div>

<ReadingPanel
	open={opened !== null}
	onOpenChange={(up) => {
		if (!up) opened = null;
	}}
	title={openedName}
	width={prefs.current.readingWidth}
	onWidthChange={(px) => prefs.set('readingWidth', px)}
>
	{#if opened}
		{@const side = opened.side}
		{@const ref = opened.ref}
		<div class="space-y-3 pt-1">
			<h2 class="text-2xl leading-snug font-semibold tracking-tight">{openedName}</h2>
			<div class="flex flex-wrap gap-1">
				{#each SIDES as one (one.side)}
					<Button
						variant={side === one.side ? 'secondary' : 'ghost'}
						class="h-9 rounded-full text-xs"
						aria-pressed={side === one.side}
						onclick={() => void openRow(ref, one.side)}
					>
						{one.named}
					</Button>
				{/each}
			</div>
		</div>

		{#if opened.reading}
			<Skeleton class="mt-4 h-24 w-full" />
		{:else if !opened.note}
			<p class="py-8 text-center text-muted-foreground">
				{side === 'draft' ? BINNED : NOT_YOURS_YET}
			</p>
		{:else if opened.note.sections.length === 0}
			<p class="py-8 text-center text-muted-foreground">{UNWRITTEN}</p>
		{:else}
			{@const shown = opened.note}
			<div class="mt-4 space-y-4">
				{#each shown.sections as section (section.ref)}
					<div class="space-y-1">
						{#if drafted.has(section.ref)}
							<p class="text-xs text-muted-foreground">Written into by the chat</p>
						{/if}
						<HeldStack
							note={shown.note}
							author={shown.note.created_by}
							blocks={[section]}
							pictures={{ held: true, picture: (upload) => shown.picture(upload) }}
							{references}
							{emoji}
						/>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</ReadingPanel>
