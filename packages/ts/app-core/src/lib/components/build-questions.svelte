<script lang="ts">
	// What the notes do not say that the build cannot be right without, and the
	// two answers to one — DESIGN.md § "A build". An answer is a note somebody
	// writes, never a field on this card.
	import type { BuildSlug, OwnedRef } from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import type { Question } from './build-said.js';

	let {
		questions,
		busy = false,
		writing = false,
		nameOf,
		titleOf,
		onAnswer,
		onDrop,
		onOpen
	}: {
		questions: readonly Question[];
		busy?: boolean;
		/** A note is already being written: one answer at a time, so the writing
		 *  surface the reader is on cannot be taken for another question's. */
		writing?: boolean;
		/** A note as somebody cites it, and nothing for one not in hand. */
		nameOf: (note: OwnedRef) => string | undefined;
		/** What a task is called, for a question that is holding one. */
		titleOf: (task: BuildSlug) => string | undefined;
		onAnswer: (need: BuildSlug) => void;
		onDrop: (need: BuildSlug) => void;
		onOpen: (note: OwnedRef) => void;
	} = $props();
</script>

<ul class="space-y-2" aria-label="What the build is asking">
	{#each questions as one (one.need.id)}
		{@const held = one.by === undefined ? undefined : titleOf(one.by)}
		<li class="rounded-lg border border-border px-3 py-2" data-build-question={one.need.id}>
			<p class="text-sm break-words">{one.need.question}</p>
			{#if one.need.about}
				{@const name = nameOf(one.need.about)}
				{@const note = one.need.about}
				<button
					type="button"
					class="mt-1 inline-flex min-h-8 items-center text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onclick={() => onOpen(note)}
				>
					About {name ?? 'a note'}
				</button>
			{/if}
			<p class="mt-0.5 text-xs break-words text-muted-foreground">{one.need.why}</p>
			{#if held}
				<p class="mt-0.5 text-xs text-muted-foreground">{held} is held until this is answered.</p>
			{/if}

			{#if one.note}
				{@const name = nameOf(one.note)}
				{@const note = one.note}
				<button
					type="button"
					class="mt-1 inline-flex min-h-9 items-center text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onclick={() => onOpen(note)}
				>
					Answered in {name ?? 'a note'}
				</button>
			{:else if one.dropped}
				<p class="mt-1 text-xs text-muted-foreground">Set aside.</p>
			{:else}
				<div class="mt-1 flex flex-wrap gap-2">
					<Button
						variant="outline"
						class="h-9 text-xs"
						disabled={busy || writing}
						onclick={() => onAnswer(one.need.id)}
					>
						Write the note
					</Button>
					<Button
						variant="ghost"
						class="h-9 text-xs"
						disabled={busy}
						onclick={() => onDrop(one.need.id)}
					>
						Set it aside
					</Button>
				</div>
			{/if}
		</li>
	{/each}
</ul>
