<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** A note somebody deleted, as the surface that puts it back offers it. */
	export interface BinnedNote {
		ref: OwnedRef;
		/** The number they cite it by, which is how they will recognise it.
		 *  Absent on one with none; the title names it. */
		address?: string;
		/** Which graph it comes back into. An address only means one thing
		 *  inside one, so a listing across graphs says which. */
		graph: string;
		title: string;
		/** The note and everything that comes back with it. */
		notes: number;
		/** How long is left to put it back, in the words the row shows. */
		within: string;
	}
</script>

<script lang="ts">
	// Everything deleted that can still be put back — DESIGN.md § "What you
	// deleted". Its own surface, because somebody looking for a note they threw
	// away is not looking for a list of their graphs.
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		notes,
		keptForDays,
		says = null,
		onRestore
	}: {
		open?: boolean;
		/** Newest first; the caller decides the order. */
		notes: readonly BinnedNote[];
		/** How long a deleted note stays, in days. The sentence that promises it
		 *  and the sweep that ends it read the same number. */
		keptForDays: number;
		/** Why the last put-back did not happen, in words to show. */
		says?: string | null;
		/** Absent is a surface that can only be read, which is what a graph
		 *  somebody is only visiting offers. */
		onRestore?: (ref: OwnedRef) => Promise<unknown>;
	} = $props();

	let putting = $state<OwnedRef | null>(null);

	function nameOf(note: BinnedNote): string {
		return note.title.trim() || 'Untitled';
	}

	async function putBack(note: BinnedNote): Promise<void> {
		if (!onRestore || putting !== null) return;
		putting = note.ref;
		try {
			await onRestore(note.ref);
		} finally {
			putting = null;
		}
	}
</script>

<ResponsiveModal
	bind:open
	title="What you deleted"
	description="Everything you have deleted in the last {keptForDays} days. Put one back and it returns where it was, with everything that went with it."
>
	<div class="space-y-3 px-2 pt-2 pb-2">
		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}

		{#if notes.length === 0}
			<p class="px-2 text-sm text-muted-foreground" role="status">
				Nothing here. A note you delete waits {keptForDays} days before it goes for good.
			</p>
		{:else}
			<ul class="space-y-1">
				{#each notes as note (note.ref)}
					<li class="flex items-center gap-2 px-2 py-1">
						<div class="min-w-0 flex-1">
							<p class="flex min-w-0 items-baseline gap-2 text-sm">
								{#if note.address}
									<span class="shrink-0 address text-xs">{note.address}</span>
								{/if}
								<span class="min-w-0 flex-1 truncate">{nameOf(note)}</span>
							</p>
							<p class="truncate text-xs text-muted-foreground">
								{note.graph} ·
								{note.notes === 1 ? '1 note' : `${note.notes.toLocaleString()} notes`} ·
								{note.within}
							</p>
						</div>
						{#if onRestore}
							<Button
								variant="outline"
								class="h-control shrink-0 rounded-full text-xs"
								disabled={putting !== null}
								aria-label="Put {nameOf(note)} in {note.graph} back"
								onclick={() => void putBack(note)}
							>
								<Undo2 class="size-4" />
								{putting === note.ref ? 'Putting it back' : 'Put it back'}
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</ResponsiveModal>
