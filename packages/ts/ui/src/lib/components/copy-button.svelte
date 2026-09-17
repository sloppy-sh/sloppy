<script lang="ts">
	// Handing somebody a line of text they need somewhere else. A webview can
	// refuse the clipboard outright, so the line beside it stays selectable and
	// this says to select it rather than appearing to have worked.
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import CopyX from '@lucide/svelte/icons/copy-x';
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { Button } from './ui/button/index.js';

	let {
		value,
		label = 'Copy',
		class: className
	}: {
		value: string;
		/** What it is called, in the voice of the surface it is on. */
		label?: string;
		class?: string;
	} = $props();

	/** How long the answer stands before the offer comes back. */
	const SAID_FOR_MS = 2500;

	let went = $state<'asked' | 'copied' | 'refused'>('asked');
	let clearing: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		clearTimeout(clearing);
		try {
			await navigator.clipboard.writeText(value);
			went = 'copied';
		} catch {
			went = 'refused';
		}
		clearing = setTimeout(() => (went = 'asked'), SAID_FOR_MS);
	}

	const says = $derived(
		went === 'copied' ? 'Copied' : went === 'refused' ? 'Select it to copy' : label
	);

	onDestroy(() => clearTimeout(clearing));
</script>

<Button
	variant="ghost"
	size="icon"
	class={cn('size-9 shrink-0 text-muted-foreground', className)}
	aria-label={says}
	aria-live="polite"
	onclick={copy}
>
	{#if went === 'copied'}
		<Check class="size-4" />
	{:else if went === 'refused'}
		<CopyX class="size-4" />
	{:else}
		<Copy class="size-4" />
	{/if}
</Button>
