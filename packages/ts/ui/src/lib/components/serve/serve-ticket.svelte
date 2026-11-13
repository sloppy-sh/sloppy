<script lang="ts">
	// How a headset on another network finds this desk: the whole address as
	// text that copies on tap, and as a QR code.
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { qrDrawing } from './qr.js';

	let { ticket, class: className }: { ticket: string; class?: string } = $props();

	const SAID_FOR_MS = 2500;

	const drawing = $derived(qrDrawing(ticket));
	let went = $state<'asked' | 'copied' | 'refused'>('asked');
	let clearing: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		clearTimeout(clearing);
		try {
			await navigator.clipboard.writeText(ticket);
			went = 'copied';
		} catch {
			went = 'refused';
		}
		clearing = setTimeout(() => (went = 'asked'), SAID_FOR_MS);
	}

	onDestroy(() => clearTimeout(clearing));
</script>

<div class={cn('flex flex-col gap-4 sm:flex-row sm:items-start', className)}>
	<!-- Dark on white whatever the look: not every reader takes a code drawn light on dark. -->
	<svg
		role="img"
		aria-label="This desk's address as a code to scan"
		viewBox="0 0 {drawing.size} {drawing.size}"
		shape-rendering="crispEdges"
		class="size-48 shrink-0 rounded-md"
	>
		<rect width={drawing.size} height={drawing.size} fill="#fff" />
		<path d={drawing.path} fill="#000" />
	</svg>
	<div class="min-w-0 flex-1 space-y-1">
		<button
			type="button"
			onclick={copy}
			class="w-full rounded-md border border-border bg-card p-3 text-left font-mono text-xs break-all text-foreground transition-colors duration-150 ease-out select-text hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		>
			{ticket}
		</button>
		<p class="text-xs text-muted-foreground" aria-live="polite">
			{went === 'copied' ? 'Copied' : went === 'refused' ? 'Select it to copy' : 'Tap to copy'}
		</p>
	</div>
</div>
