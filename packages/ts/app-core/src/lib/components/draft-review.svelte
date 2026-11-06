<script lang="ts">
	// Reading a draft of the notes whole, and taking it in with one act —
	// DESIGN.md § "Reading a draft". It stands where the chat stands: on a phone
	// the review IS the panel, and beside the graph it is that same dock given
	// room, with the canvas behind it drawing the two states against each other.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import {
		A_NOTE,
		anchorsOf,
		type CodeAnchor,
		type ImportResolution,
		type OwnedRef
	} from '@sloppy/types';
	import { SettleImport } from '@sloppy/ui';
	import { Badge } from '@sloppy/ui/badge';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import {
		conflictHeading,
		DISCARD_COSTS,
		DRAFT_BAND_HEADINGS,
		DRAFT_BANDS,
		draftRows,
		picturesSaid,
		rowSaid,
		settlingSaid,
		type DraftBand,
		type DraftRow
	} from '../draft-said.js';
	import { chatDraft, type DraftSide } from '../stores/chat-draft.svelte.js';
	import CodePlace from './code-place.svelte';
	import CodeSheet from './code-sheet.svelte';

	let {
		onBack,
		onDone,
		onOpen
	}: {
		/** Back to the conversation, with the draft left standing. */
		onBack: () => void;
		/** The draft is gone — taken in, or thrown away. */
		onDone: () => void;
		/** Read one of these notes, on the copy the row stands for. */
		onOpen: (note: OwnedRef, side: DraftSide) => void;
	} = $props();

	const NO_DRAFT = 'There is no draft to read.';
	const LEADS_TO = 'What this note leads to';

	/** A draft that changed something none of these bands name. */
	const NOT_LISTED =
		'Nothing the chat did shows up in this list, and the draft is not empty. Merging takes in what it changed.';

	const read = $derived(chatDraft.read);
	const counts = $derived(chatDraft.counts);
	const conflicts = $derived(read?.conflicts ?? []);
	const rows = $derived(read ? draftRows(read.difference, read.conflicts, read.named) : []);
	const pictures = $derived(counts ? picturesSaid(counts) : null);

	let settled = $state.raw<readonly ImportResolution[]>([]);
	const unsettled = $derived(conflicts.length - settled.length);

	/** Whether the project's code is here to open a place in. */
	let reachable = $state(false);
	let showing = $state(false);
	let shownAnchor = $state.raw<CodeAnchor | null>(null);
	/** The places each row's note points at, as the copy it stands for has it. */
	let places = $state.raw<ReadonlyMap<OwnedRef, CodeAnchor[]>>(new Map());

	const sideOf = (row: DraftRow): DraftSide => (row.band === 'removed' ? 'folder' : 'draft');

	$effect(() => {
		const asked = rows;
		if (!reachable || asked.length === 0) return;
		let live = true;
		void Promise.all(
			asked.map(async (row) => {
				const note = await chatDraft.asRead(sideOf(row), row.ref);
				return [row.ref, note?.sections.flatMap((one) => anchorsOf(one.content)) ?? []] as const;
			})
		).then((found) => {
			if (live) places = new Map(found);
		});
		return () => {
			live = false;
		};
	});

	function show(anchor: CodeAnchor): void {
		shownAnchor = anchor;
		showing = true;
	}

	function inBand(band: DraftBand) {
		return rows.filter((one) => one.band === band);
	}

	async function take(): Promise<void> {
		if (await chatDraft.merge({ resolutions: [...settled] })) onDone();
	}

	async function throwAway(): Promise<void> {
		if (await chatDraft.discard()) onDone();
	}
</script>

{#snippet bandHeading(heading: string)}
	<h3 class="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
		{heading}
	</h3>
{/snippet}

{#snippet band(heading: string, held: DraftRow[])}
	<section class="space-y-1 py-4 first:pt-0" data-draft-band>
		{@render bandHeading(heading)}
		<ul class="space-y-1">
			{#each held as row (row.ref)}
				{@const note = read?.named.get(row.ref)}
				{@const said = rowSaid(row)}
				{@const leads = places.get(row.ref) ?? []}
				<li data-draft-row={row.ref}>
					<button
						type="button"
						class="flex w-full flex-col gap-0.5 rounded-md px-1 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						onclick={() => onOpen(row.ref, sideOf(row))}
					>
						<span class="flex min-w-0 items-baseline gap-2">
							{#if note?.address !== undefined}
								<Badge variant="outline" class="shrink-0 font-mono font-normal">
									{note.address}
								</Badge>
							{/if}
							<span class="min-w-0 truncate text-sm font-medium">
								{note?.title.trim() || A_NOTE}
							</span>
						</span>
						{#if said !== ''}
							<span class="text-xs break-words text-muted-foreground">{said}</span>
						{/if}
					</button>
					{#if leads.length > 0}
						<div class="space-y-1 px-1 pb-2">
							<p class="text-xs text-muted-foreground">{LEADS_TO}</p>
							<ul class="flex flex-wrap gap-1" aria-label={LEADS_TO}>
								{#each leads as anchor, at (at)}
									<li class="min-w-0"><CodePlace {anchor} onShow={show} /></li>
								{/each}
							</ul>
						</div>
					{/if}
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

	<div class="min-h-0 flex-1 divide-y divide-border overflow-x-hidden overflow-y-auto">
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
				<div class="space-y-3 pb-4">
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
				<p class="px-1 py-4 text-sm text-muted-foreground">{pictures}</p>
			{/if}

			{#if rows.length === 0 && !pictures}
				<p class="px-1 text-sm text-muted-foreground">{NOT_LISTED}</p>
			{/if}
		{/if}

		{#if chatDraft.says}
			<p class="px-1 py-4 text-sm text-destructive" role="alert">{chatDraft.says}</p>
		{/if}
	</div>

	<div class="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
		{#if read && !read.nothing}
			<Button
				class="h-control w-full"
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
			class="h-control w-full text-muted-foreground"
			disabled={chatDraft.busy}
			onclick={() => void throwAway()}
		>
			Discard
		</Button>
		<p class="px-1 text-xs text-muted-foreground">{DISCARD_COSTS}</p>
	</div>
</div>

<CodeSheet
	bind:open={showing}
	onReachable={(is) => (reachable = is)}
	anchor={shownAnchor}
	notes={chatDraft.notesOn('draft')}
	onOpenNote={(note) => onOpen(note, 'draft')}
/>
