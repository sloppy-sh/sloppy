<script lang="ts">
	// One note out of a region the reader holds, on the same reading surface
	// their own notes get — DESIGN.md § Layout. Nothing here writes: the copy is
	// the author's words as they published them.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import type { BlockView, NodeView } from '@sloppy/types';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { NoteEmoji } from '../editor/contract.js';
	import type { PictureSource } from '../editor/picture-node.js';
	import type { ReferenceReader } from '../editor/reference-node.js';
	import { nameOf } from '../identity/person.js';
	import ReadingPanel from '../reading-panel.svelte';
	import Conversation, { type ConversationProps } from '../social/conversation.svelte';
	import HeldStack from './held-stack.svelte';
	import type { Peer } from './peer.js';

	let {
		note,
		author,
		blocks,
		loading = false,
		says = null,
		pictures,
		references,
		emoji,
		conversation = null,
		onClose
	}: {
		/** The note being read; null closes the surface. */
		note: NodeView | null;
		author: Peer;
		/** Its stack, in `ord` order. */
		blocks: readonly BlockView[];
		loading?: boolean;
		/** Why the note's sections are not here. */
		says?: string | null;
		pictures: PictureSource;
		references: ReferenceReader;
		emoji: NoteEmoji['catalog'];
		/** What people said on this note, and the way to answer it. Absent draws
		 *  no conversation at all: who may answer is the host's to weigh. */
		conversation?: ConversationProps | null;
		onClose: () => void;
	} = $props();
</script>

<ReadingPanel
	open={note !== null}
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
	title={note ? `${note.address} ${note.title || 'Untitled'}` : 'A note you are holding'}
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
				<span class="ml-auto truncate address text-sm text-foreground/70 select-text">
					{note.address}
				</span>
			</div>
		</header>

		<div class="space-y-3 pt-1">
			<h2 class="text-2xl leading-snug font-semibold tracking-tight">
				{note.title || 'Untitled'}
			</h2>
			<p class="text-sm text-muted-foreground">
				{author.person ? nameOf(author.person) : author.identity} wrote this
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

		{#if conversation}
			<div class="mt-7">
				<Conversation {...conversation} />
			</div>
		{/if}
	{/if}
</ReadingPanel>
