<script lang="ts">
	// The list `:` opens. Its state is EmojiCompletions; `./caret-menu.svelte`
	// puts it where the caret is.
	import { isCustomEmoji } from '../../emoji/catalog.js';
	import CaretMenu from './caret-menu.svelte';
	import type { EmojiCompletions } from './emoji-suggestion.svelte.js';

	let { completions }: { completions: EmojiCompletions } = $props();

	const ROW = 40;
	const WIDTH = 232;
	const TALLEST = 240;
</script>

<CaretMenu
	open={completions.open}
	rect={completions.rect}
	width={WIDTH}
	rows={completions.items.length}
	rowHeight={ROW}
	maxHeight={TALLEST}
	label="Emoji"
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
</CaretMenu>
