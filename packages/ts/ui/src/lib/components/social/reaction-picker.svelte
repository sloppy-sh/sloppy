<script lang="ts" module>
	/** What a person picked to react with: a character off the keyboard, or an
	 *  entry in their own catalog. */
	export type ReactionPick =
		| { kind: 'character'; character: string }
		| { kind: 'emoji'; emoji_id: string };
</script>

<script lang="ts">
	// Reacting to a note, from the same two catalogs the writing surface offers.
	import { Input } from '$lib/components/ui/input/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import {
		isCustomEmoji,
		searchEmoji,
		UNICODE_EMOJI,
		type CustomEmojiEntry,
		type EmojiEntry
	} from '../../emoji/catalog.js';
	import { EMOJI_PX } from '../editor/fit.js';

	let {
		open = $bindable(false),
		/** The reader's own catalog. A reaction is read back through the catalog
		 *  of whoever made it, so only their own are offered. */
		custom = [],
		onpick
	}: {
		open?: boolean;
		custom?: readonly CustomEmojiEntry[];
		onpick: (pick: ReactionPick) => void;
	} = $props();

	let query = $state('');

	const groups = $derived<{ name: string; emoji: EmojiEntry[] }[]>(
		(query.trim()
			? [{ name: 'Matches', emoji: searchEmoji(query, 60, custom) }]
			: [
					...(custom.length > 0 ? [{ name: 'Yours', emoji: [...custom] }] : []),
					...UNICODE_EMOJI.map((category) => ({ name: category.name, emoji: [...category.emoji] }))
				]
		).filter((group) => group.emoji.length > 0)
	);

	function choose(entry: EmojiEntry): void {
		onpick(
			isCustomEmoji(entry)
				? { kind: 'emoji', emoji_id: entry.id }
				: { kind: 'character', character: entry.char }
		);
		open = false;
		query = '';
	}
</script>

<ResponsiveModal bind:open title="React" headed={false} class="sm:max-w-md">
	<div class="space-y-3 px-2 pt-2">
		<Input
			bind:value={query}
			class="h-control"
			placeholder="Search"
			aria-label="Search emoji"
			autocapitalize="none"
			autocomplete="off"
			spellcheck="false"
		/>

		<div class="max-h-[50vh] overflow-y-auto scroll-fade-y [--scroll-fade:1rem]">
			{#each groups as group (group.name)}
				<h3 class="px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group.name}</h3>
				<div class="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]">
					{#each group.emoji as entry (isCustomEmoji(entry) ? entry.id : entry.shortcode)}
						<button
							type="button"
							title={entry.shortcode}
							aria-label={entry.shortcode}
							onclick={() => choose(entry)}
							class="flex size-control items-center justify-center rounded-md text-2xl transition-colors duration-150 ease-out hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						>
							{#if isCustomEmoji(entry)}
								<img
									src={entry.src}
									alt={entry.shortcode}
									width={EMOJI_PX}
									height={EMOJI_PX}
									class="size-6 object-contain"
								/>
							{:else}
								{entry.char}
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<p class="px-1 py-6 text-center text-sm text-muted-foreground">Nothing matches that.</p>
			{/each}
		</div>
	</div>
</ResponsiveModal>
