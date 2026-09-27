<script lang="ts">
	// What one act lays out for the person — the note, line or mark it is about,
	// and the rows that say what becomes of it. It stands in front of a write as
	// the question and after one as what came of it, so nothing here is written
	// in a tense.
	import Circle from '@lucide/svelte/icons/circle';
	import FileText from '@lucide/svelte/icons/file-text';
	import Spline from '@lucide/svelte/icons/spline';
	import type { ChatCard, ChatCardAbout } from '@sloppy/types';

	let { card }: { card: ChatCard } = $props();

	const MARKS: Record<ChatCardAbout, typeof FileText> = {
		note: FileText,
		line: Spline,
		mark: Circle
	};

	const About = $derived(MARKS[card.about]);
</script>

<div class="rounded-lg border border-border bg-card p-3">
	{#if card.heading !== ''}
		<div class="flex items-start gap-2">
			<About class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<p class="min-w-0 flex-1 text-sm font-medium break-words">{card.heading}</p>
		</div>
	{/if}
	{#if card.rows.length > 0}
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 {card.heading === '' ? '' : 'mt-2'}">
			{#each card.rows as row, at (at)}
				<dt class="text-xs text-muted-foreground">{row.label}</dt>
				<dd class="min-w-0 text-xs break-words">{row.value}</dd>
			{/each}
		</dl>
	{/if}
</div>
