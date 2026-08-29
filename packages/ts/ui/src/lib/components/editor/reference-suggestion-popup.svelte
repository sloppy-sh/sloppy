<script lang="ts">
	// The list `[[` opens, anchored to the caret. Its state is NoteCompletions.
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import type { NoteChoice, NoteCompletions } from './reference-suggestion.svelte.js';

	let { completions }: { completions: NoteCompletions } = $props();

	const ROW = 44;
	const WIDTH = 288;

	const anchor = $derived.by(() => {
		const rect = completions.rect;
		if (!rect) return null;
		const height = Math.min(completions.items.length, 6) * ROW + 8;
		const below = rect.bottom + 6;
		const room = window.innerHeight - below;
		const top = room < height ? Math.max(8, rect.top - height - 6) : below;
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
		return { top, left };
	});

	const key = (choice: NoteChoice) =>
		choice.kind === 'note' ? choice.note.ref : `make-${choice.relation}`;
</script>

{#if completions.open && anchor}
	<div
		class="fixed z-50 max-h-72 overflow-y-auto overscroll-contain rounded-lg border bg-popover scroll-fade-y p-1 text-popover-foreground shadow-md [--scroll-fade:0.75rem]"
		style="top: {anchor.top}px; left: {anchor.left}px; width: {WIDTH}px"
		role="listbox"
		aria-label="Notes"
	>
		{#if completions.making !== null}
			<p class="px-2 py-2.5 text-sm text-muted-foreground" role="status">
				Writing “{completions.making}”…
			</p>
		{:else}
			{#if completions.refused}
				<p class="px-2 py-2 text-sm text-destructive" role="alert">{completions.refused}</p>
			{/if}
			{#each completions.items as choice, i (key(choice))}
				<button
					type="button"
					role="option"
					aria-selected={i === completions.index}
					class="flex min-h-11 w-full items-baseline gap-2.5 rounded-md px-2 py-1.5 text-left text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
					onmousedown={(event) => {
						event.preventDefault();
						completions.pick(choice);
					}}
				>
					{#if choice.kind === 'note'}
						<span class="shrink-0 address text-xs text-muted-foreground">{choice.note.address}</span
						>
						<span class="min-w-0 flex-1 truncate">{choice.note.title || 'Untitled'}</span>
					{:else}
						<span class="shrink-0 self-center text-muted-foreground">
							{#if choice.relation === 'under'}
								<CornerDownRight class="size-4" aria-hidden="true" />
							{:else}
								<ArrowRight class="size-4" aria-hidden="true" />
							{/if}
						</span>
						<span class="min-w-0 flex-1 truncate text-muted-foreground">
							Write “{choice.name}” {choice.relation === 'under' ? 'under' : 'after'} this note
						</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
{/if}
