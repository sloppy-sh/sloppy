<script lang="ts">
	// Handing somebody a line of text they need somewhere else. A webview can
	// refuse the clipboard outright, so the text stays on the page to select by
	// hand and the control says so rather than appearing to have worked.
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { Button } from './ui/button/index.js';

	let {
		value,
		label = 'Copy',
		class: className
	}: {
		value: string;
		/** What it says before it is pressed. */
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

<Button variant="outline" class={cn('h-11', className)} onclick={copy} aria-live="polite">
	{says}
</Button>
