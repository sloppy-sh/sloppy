<script lang="ts">
	// Emoji without typing a shortcode. What gets written is still the shortcode,
	// and "Large" is the `::code::` form — see `../../emoji/tokenize.ts`.
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { UNICODE_EMOJI, searchEmoji, type UnicodeEmoji } from '../../emoji/catalog.js';

	let {
		open = $bindable(false),
		onpick
	}: {
		open?: boolean;
		onpick: (emoji: UnicodeEmoji, sticker: boolean) => void;
	} = $props();

	let query = $state('');
	let large = $state(false);

	const groups = $derived(
		query.trim()
			? [{ name: 'Matches', emoji: searchEmoji(query, 60) }]
			: UNICODE_EMOJI.map((category) => ({ name: category.name, emoji: [...category.emoji] }))
	);

	function choose(emoji: UnicodeEmoji) {
		onpick(emoji, large);
		open = false;
		query = '';
	}
</script>

<ResponsiveModal bind:open title="Emoji" description="Pick one to drop into the note.">
	<div class="flex items-center gap-3 px-4 pb-3">
		<Input bind:value={query} placeholder="Search" class="h-10 flex-1" aria-label="Search emoji" />
		<div class="flex shrink-0 items-center gap-2">
			<Switch id="emoji-large" bind:checked={large} />
			<Label for="emoji-large" class="text-sm text-muted-foreground">Large</Label>
		</div>
	</div>

	<div
		class="max-h-[50vh] overflow-y-auto scroll-fade-y px-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] [--scroll-fade:1rem]"
	>
		{#each groups as group (group.name)}
			{#if group.emoji.length > 0}
				<p class="pt-2 pb-1.5 text-xs tracking-wide text-muted-foreground uppercase">
					{group.name}
				</p>
				<div class="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]">
					{#each group.emoji as emoji (emoji.shortcode)}
						<button
							type="button"
							title={emoji.shortcode}
							aria-label={emoji.shortcode}
							class="flex aspect-square items-center justify-center rounded-md text-2xl hover:bg-accent"
							onclick={() => choose(emoji)}
						>
							{emoji.char}
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			<p class="py-6 text-center text-sm text-muted-foreground">Nothing by that name.</p>
		{/each}
	</div>
</ResponsiveModal>
