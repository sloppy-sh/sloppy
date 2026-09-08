<script lang="ts">
	// One note out of a region the reader holds, on the same reading surface
	// their own notes get — DESIGN.md § Layout. Nothing here writes: the copy is
	// the author's words as they published them.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import type { BlockView, NodeView } from '@sloppy/types';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { NoteEmoji } from '../editor/contract.js';
	import type { PictureSource } from '../editor/picture-node.js';
	import type { ReferenceReader } from '../editor/reference-node.js';
	import { nameOr, personOr } from '../identity/person.js';
	import ReadingPanel from '../reading-panel.svelte';
	import Conversation, { type ConversationProps } from '../social/conversation.svelte';
	import HeldStack from './held-stack.svelte';
	import type { Peer } from './peer.js';

	let {
		note,
		author,
		notebook = undefined,
		blocks,
		loading = false,
		says = null,
		writingRefused = null,
		pictures,
		references,
		emoji,
		conversation = null,
		onCite,
		onClose
	}: {
		/** The note being read; null closes the surface. */
		note: NodeView | null;
		author: Peer;
		/** What its author calls the notebook the address is read in, where the
		 *  name travelled with the copy. */
		notebook?: string;
		/** Its stack, in `ord` order. */
		blocks: readonly BlockView[];
		loading?: boolean;
		/** Why the note's sections are not here. */
		says?: string | null;
		/** Why the note of the reader's own was not written. */
		writingRefused?: string | null;
		pictures: PictureSource;
		references: ReferenceReader;
		emoji: NoteEmoji['catalog'];
		/** What people said on this note, and the way to answer it. Absent draws
		 *  no conversation at all: who may answer is the host's to weigh. */
		conversation?: ConversationProps | null;
		/** Write a note of the reader's own citing this one. Absent offers none. */
		onCite?: (note: NodeView) => void;
		onClose: () => void;
	} = $props();

	/** The citation, as somebody says it: the address, and the notebook it is
	 *  read in where its name came with it. Empty for a note its author gave no
	 *  address, which is nothing anybody can cite. */
	const citation = $derived(
		!note || note.address === undefined
			? ''
			: notebook
				? `${note.address} · ${notebook}`
				: note.address
	);
	let copied = $state(false);
	let sayingCopied: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(citation);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(sayingCopied);
		sayingCopied = setTimeout(() => (copied = false), 1600);
	}
</script>

<ReadingPanel
	open={note !== null}
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
	title={note
		? [note.address, note.title || 'Untitled'].filter(Boolean).join(' ')
		: 'A note you are holding'}
>
	{#if note}
		<header
			style="top: var(--reading-head, 0px)"
			class="sticky z-20 -mx-2 border-b border-border bg-background px-2 pt-2 pb-1 sm:-mx-1 sm:px-1"
		>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={onClose}
					class="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					<ArrowLeft class="size-4" />
					Their graph
				</button>
				<button
					type="button"
					onclick={copy}
					aria-label="Copy this note's address"
					class="ml-auto inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-foreground/70 transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					<span class="truncate address select-text">{note.address}</span>
					{#if copied}
						<Check class="size-4 shrink-0" />
					{/if}
				</button>
			</div>
		</header>

		<div class="space-y-3 pt-1">
			<h2 class="text-2xl leading-snug font-semibold tracking-tight">
				{note.title || 'Untitled'}
			</h2>
			<p class="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm text-muted-foreground">
				<span class="min-w-0 truncate">{nameOr(personOr(author))}</span>
				<span>wrote this{notebook ? ` in ${notebook}` : ''}</span>
			</p>

			{#if note.tags.length > 0}
				<div class="flex flex-wrap items-center gap-1.5">
					{#each note.tags as tag (tag)}
						<Badge variant="outline" class="text-muted-foreground">{tag}</Badge>
					{/each}
				</div>
			{/if}
		</div>

		{#if loading}
			<Skeleton class="mt-4 h-24 w-full" />
		{:else if says}
			<p class="py-8 text-center text-muted-foreground" role="alert">{says}</p>
		{:else if blocks.length === 0}
			<p class="py-8 text-center text-muted-foreground">There is nothing written in this note.</p>
		{:else}
			{#key note.ref}
				<HeldStack author={note.created_by} {blocks} {pictures} {references} {emoji} />
			{/key}
		{/if}

		{#if onCite}
			<div class="mt-6 space-y-2">
				<Button
					variant="outline"
					class="h-11 w-full"
					onclick={() => {
						if (note) onCite(note);
					}}
				>
					<PenLine class="size-4" />
					Write a note of your own
				</Button>
				{#if writingRefused}
					<p class="text-sm text-destructive" role="alert">{writingRefused}</p>
				{/if}
			</div>
		{/if}

		{#if conversation}
			<div class="mt-7">
				<Conversation {...conversation} />
			</div>
		{/if}
	{/if}
</ReadingPanel>
