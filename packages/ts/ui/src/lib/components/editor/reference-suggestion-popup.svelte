<script lang="ts">
	// The list `[[` opens. Its state is NoteCompletions; `./caret-menu.svelte`
	// puts it where the caret is.
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CaretMenu from './caret-menu.svelte';
	import type { NoteChoice, NoteCompletions } from './reference-suggestion.svelte.js';

	let { completions }: { completions: NoteCompletions } = $props();

	const ROW = 44;
	const WIDTH = 288;
	const TALLEST = 288;

	const key = (choice: NoteChoice) =>
		choice.kind === 'note' ? choice.note.ref : `make-${choice.relation}`;

	const label = (choice: NoteChoice) =>
		choice.kind === 'note' && choice.graph
			? `${choice.note.address} ${choice.note.title || 'Untitled'}, in ${choice.graph}`
			: undefined;
</script>

<CaretMenu
	open={completions.open}
	rect={completions.rect}
	width={WIDTH}
	rows={completions.items.length}
	rowHeight={ROW}
	maxHeight={TALLEST}
	label="Notes"
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
				aria-label={label(choice)}
				aria-selected={i === completions.index}
				class="flex min-h-11 w-full items-baseline gap-2.5 rounded-md px-2 py-1.5 text-left text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
				onmousedown={(event) => {
					event.preventDefault();
					completions.pick(choice);
				}}
			>
				{#if choice.kind === 'note'}
					<span class="shrink-0 address text-xs text-muted-foreground">{choice.note.address}</span>
					<span class="min-w-0 flex-1 truncate">{choice.note.title || 'Untitled'}</span>
					{#if choice.graph}
						<span class="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
							{choice.graph}
						</span>
					{/if}
				{:else}
					<span class="shrink-0 self-center text-muted-foreground">
						{#if choice.relation === 'under'}
							<CornerDownRight class="size-4" aria-hidden="true" />
						{:else}
							<ArrowRight class="size-4" aria-hidden="true" />
						{/if}
					</span>
					<!-- Which of the two this is decides the address the note is minted
					     at, and an address never changes, so the name is what gives way. -->
					<span class="flex min-w-0 flex-1 items-baseline gap-1 text-muted-foreground">
						<span class="min-w-0 truncate">Write “{choice.name}”</span>
						<span class="shrink-0">{choice.relation === 'under' ? 'under' : 'after'} this note</span
						>
					</span>
				{/if}
			</button>
		{/each}
	{/if}
</CaretMenu>
