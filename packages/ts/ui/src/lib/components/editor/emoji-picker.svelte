<script lang="ts">
	// Emoji without typing a shortcode, from both catalogs: the Unicode set and
	// the pictures this person uploaded. What gets written is still the
	// shortcode, and "Large" is the `::code::` form — see `../../emoji/tokenize.ts`.
	import X from '@lucide/svelte/icons/x';
	import { EMOJI_SHORTCODE_PATTERN, type CustomEmojiKind } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import {
		isCustomEmoji,
		searchEmoji,
		UNICODE_EMOJI,
		type CustomEmojiEntry,
		type EmojiEntry
	} from '../../emoji/catalog.js';
	import { EMOJI_PX, fitted } from './fit.js';

	const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

	let {
		open = $bindable(false),
		custom = [],
		onpick,
		onadd,
		onremove
	}: {
		open?: boolean;
		/** This person's own catalog, `src` already resolved for an `<img>`. */
		custom?: readonly CustomEmojiEntry[];
		onpick: (entry: EmojiEntry, sticker: boolean) => void;
		onadd: (entry: { file: File; shortcode: string; kind: CustomEmojiKind }) => Promise<void>;
		onremove: (id: CustomEmojiEntry['id']) => Promise<void>;
	} = $props();

	let query = $state('');
	let large = $state(false);
	let editing = $state(false);
	let chooser = $state<HTMLInputElement | null>(null);
	let shortcode = $state('');
	let asSticker = $state(false);
	let adding = $state(false);
	let refused = $state<string | null>(null);
	let dropping = $state<CustomEmojiEntry | null>(null);
	let confirming = $state(false);

	const typed = $derived(shortcode.trim().toLowerCase());
	const named = $derived(EMOJI_SHORTCODE_PATTERN.test(typed));
	const taken = $derived(custom.some((entry) => entry.shortcode.toLowerCase() === typed));
	const groups = $derived<{ name: string; emoji: EmojiEntry[] }[]>(
		(query.trim()
			? [{ name: 'Matches', emoji: searchEmoji(query, 60, custom) }]
			: UNICODE_EMOJI.map((category) => ({ name: category.name, emoji: [...category.emoji] }))
		).filter((group) => group.emoji.length > 0)
	);

	function choose(entry: EmojiEntry) {
		onpick(entry, large);
		open = false;
		query = '';
		editing = false;
	}

	async function add(file: File): Promise<void> {
		adding = true;
		refused = null;
		try {
			const bytes = await fitted(file, EMOJI_PX);
			await onadd({ file: bytes, shortcode: typed, kind: asSticker ? 'sticker' : 'emoji' });
			shortcode = '';
			asSticker = false;
		} catch (error) {
			refused =
				error instanceof Error && error.message
					? error.message
					: 'That picture could not be added. Try again in a moment.';
		} finally {
			adding = false;
		}
	}
</script>

{#snippet tile(entry: EmojiEntry)}
	<button
		type="button"
		title={entry.shortcode}
		aria-label={entry.shortcode}
		class="flex aspect-square items-center justify-center rounded-md text-2xl hover:bg-accent"
		onclick={() => choose(entry)}
	>
		{#if isCustomEmoji(entry)}
			<img src={entry.src} alt="" class="size-7 object-contain" />
		{:else}
			{entry.char}
		{/if}
	</button>
{/snippet}

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
		{#if !query.trim()}
			<div class="flex items-baseline justify-between gap-3 pt-2 pb-1.5">
				<p class="text-xs tracking-wide text-muted-foreground uppercase">Yours</p>
				{#if custom.length > 0}
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground"
						onclick={() => (editing = !editing)}
					>
						{editing ? 'Done' : 'Edit'}
					</button>
				{/if}
			</div>

			<div class="mb-2 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2.5">
				<div class="min-w-36 flex-1 space-y-1">
					<Label for="emoji-shortcode" class="text-xs text-muted-foreground">Name</Label>
					<Input
						id="emoji-shortcode"
						bind:value={shortcode}
						placeholder="party_parrot"
						class="h-9"
						aria-invalid={typed.length > 0 && !named}
					/>
				</div>
				<div class="flex h-9 shrink-0 items-center gap-2">
					<Switch id="emoji-as-sticker" bind:checked={asSticker} />
					<Label for="emoji-as-sticker" class="text-sm text-muted-foreground">Always large</Label>
				</div>
				<input
					bind:this={chooser}
					type="file"
					accept={ACCEPT}
					class="sr-only"
					onchange={(event) => {
						const input = event.currentTarget;
						const file = input.files?.[0];
						input.value = '';
						if (file) void add(file);
					}}
				/>
				<Button
					size="sm"
					class="h-9 shrink-0"
					disabled={!named || taken || adding}
					onclick={() => chooser?.click()}
				>
					{adding ? 'Adding…' : 'Add a picture'}
				</Button>
			</div>
			{#if typed.length > 0 && !named}
				<p class="pb-2 text-xs text-muted-foreground">2 to 32 letters, digits or underscores.</p>
			{:else if taken}
				<p class="pb-2 text-xs text-muted-foreground">You already have one by that name.</p>
			{/if}
			{#if refused}<p class="pb-2 text-xs text-destructive" role="alert">{refused}</p>{/if}

			{#if custom.length > 0}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]">
					{#each custom as entry (entry.id)}
						{#if editing}
							<button
								type="button"
								title="Remove {entry.shortcode}"
								aria-label="Remove {entry.shortcode}"
								class="relative flex aspect-square items-center justify-center rounded-md hover:bg-destructive/10"
								onclick={() => {
									dropping = entry;
									confirming = true;
								}}
							>
								<img src={entry.src} alt="" class="size-7 object-contain opacity-60" />
								<span
									class="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
								>
									<X class="size-3" />
								</span>
							</button>
						{:else}
							{@render tile(entry)}
						{/if}
					{/each}
				</div>
			{/if}
		{/if}

		{#each groups as group (group.name)}
			<p class="pt-2 pb-1.5 text-xs tracking-wide text-muted-foreground uppercase">{group.name}</p>
			<div class="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]">
				{#each group.emoji as entry (entry.shortcode)}
					{@render tile(entry)}
				{/each}
			</div>
		{:else}
			<p class="py-6 text-center text-sm text-muted-foreground">Nothing by that name.</p>
		{/each}
	</div>
</ResponsiveModal>

<ConfirmModal
	bind:open={confirming}
	title="Remove this emoji?"
	description="Notes that used :{dropping?.shortcode ??
		''}: will show the name again instead of the picture."
	confirmLabel="Remove"
	onconfirm={async () => {
		if (dropping) await onremove(dropping.id);
	}}
/>
