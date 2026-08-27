<script lang="ts">
	// The list `:` opens, anchored to the caret. Its state is EmojiCompletions.
	import { isCustomEmoji } from '../../emoji/catalog.js';
	import type { EmojiCompletions } from './emoji-suggestion.svelte.js';

	let { completions }: { completions: EmojiCompletions } = $props();

	const ROW = 40;
	const WIDTH = 232;

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
</script>

{#if completions.open && anchor}
	<div
		class="fixed z-50 max-h-60 overflow-y-auto overscroll-contain rounded-lg border bg-popover scroll-fade-y p-1 text-popover-foreground shadow-md [--scroll-fade:0.75rem]"
		style="top: {anchor.top}px; left: {anchor.left}px; width: {WIDTH}px"
		role="listbox"
		aria-label="Emoji"
	>
		{#each completions.items as emoji, i (emoji.shortcode)}
			<button
				type="button"
				role="option"
				aria-selected={i === completions.index}
				class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
				onmousedown={(event) => {
					event.preventDefault();
					completions.pick(emoji);
				}}
			>
				{#if isCustomEmoji(emoji)}
					<img src={emoji.src} alt="" class="size-5 shrink-0 object-contain" />
				{:else}
					<span class="w-5 shrink-0 text-lg leading-none">{emoji.char}</span>
				{/if}
				<span class="truncate text-muted-foreground">{emoji.shortcode}</span>
			</button>
		{/each}
	</div>
{/if}
