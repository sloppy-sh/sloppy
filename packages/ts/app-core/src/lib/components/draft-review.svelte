<script lang="ts">
	// Reading a draft of the notes whole, and taking it in with one act —
	// DESIGN.md § "Reading a draft". It stands where the chat stands: on a phone
	// the review IS the panel, and beside the graph it is that same dock given
	// room, with the canvas behind it drawing the two states against each other.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { ImportResolution, OwnedRef } from '@sloppy/types';
	import { SettleImport } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import {
		conflictHeading,
		DISCARD_COSTS,
		DRAFT_BAND_HEADINGS,
		DRAFT_BANDS,
		draftRows,
		picturesSaid,
		settlingSaid,
		type DraftBand
	} from '../draft-said.js';
	import { chatDraft, type DraftSide } from '../stores/chat-draft.svelte.js';
	import ChatCard from './chat-card.svelte';

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
						onclick={() => onOpen(row.ref, row.band === 'removed' ? 'folder' : 'draft')}
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

			{#if rows.length === 0 && !pictures}
				<p class="px-1 text-sm text-muted-foreground">{NOT_LISTED}</p>
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
