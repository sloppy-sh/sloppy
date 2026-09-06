<script lang="ts">
	// Taking an emoji met on somebody else's note into your own set, under a name
	// you choose: two people's sets can hold the same one under different names.
	import { type CopyEmojiRequest, type CustomEmoji, EMOJI_SHORTCODE_PATTERN } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		emoji,
		onclose,
		onkeep
	}: {
		/** The one being offered; `null` closes the sheet. */
		emoji: CustomEmoji | null;
		onclose: () => void;
		/** Rejects with words fit for a person; the message is shown as it is. */
		onkeep: (ask: CopyEmojiRequest) => Promise<void>;
	} = $props();

	let shortcode = $state('');
	let keeping = $state(false);
	let refused = $state<string | null>(null);

	$effect(() => {
		if (!emoji) return;
		shortcode = emoji.shortcode;
		refused = null;
	});

	const named = $derived(shortcode.trim());
	const spelled = $derived(EMOJI_SHORTCODE_PATTERN.test(named));

	async function keep(): Promise<void> {
		if (!emoji || !spelled || keeping) return;
		keeping = true;
		refused = null;
		try {
			await onkeep({ shortcode: named, kind: emoji.kind, source_emoji_id: emoji.emoji_id });
			onclose();
		} catch (error) {
			refused =
				error instanceof Error && error.message
					? error.message
					: 'That could not be kept. Try again in a moment.';
		} finally {
			keeping = false;
		}
	}
</script>

<ResponsiveModal
	open={emoji !== null}
	onOpenChange={(shown) => {
		if (!shown) onclose();
	}}
	title="Keep this emoji"
	description="It becomes yours, and stays after you let this note go."
>
	{#if emoji}
		<div class="space-y-4 px-2 pt-4 pb-2">
			<div class="flex items-center gap-3">
				<img src={emoji.src} alt={named} class="size-12 shrink-0 object-contain" />
				<Input
					bind:value={shortcode}
					class="h-11"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					aria-label="What to call it"
				/>
			</div>
			{#if named !== '' && !spelled}
				<p class="text-sm text-muted-foreground">
					Two to thirty-two letters, digits or underscores.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">You will write it as :{named}:</p>
			{/if}
			{#if refused}
				<p class="text-sm text-destructive" role="alert">{refused}</p>
			{/if}
			<Button class="h-11 w-full" disabled={keeping || !spelled} onclick={keep}>Keep it</Button>
		</div>
	{/if}
</ResponsiveModal>
