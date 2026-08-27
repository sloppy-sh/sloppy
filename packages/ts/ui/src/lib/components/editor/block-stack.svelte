<script lang="ts">
	// A stand-in for the block editor docs/ARCHITECTURE.md § "Blocks and ink"
	// describes: it reads a node's interior so the app is whole, and writes none
	// of it.
	import type { BlockStackProps } from './contract.js';

	let { blocks }: BlockStackProps = $props();
</script>

{#if blocks.length === 0}
	<p class="text-sm text-muted-foreground">Nothing written here yet.</p>
{:else}
	<div class="space-y-5 select-text">
		{#each blocks as block (block.ref)}
			{#if block.type === 'heading'}
				<h2 class="text-lg font-semibold tracking-tight">{block.content}</h2>
			{:else if block.type === 'code'}
				<pre
					class="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-address text-sm leading-relaxed">{block.content}</pre>
			{:else if block.type === 'ink'}
				<p class="text-sm text-muted-foreground">A drawing.</p>
			{:else}
				<p class="text-base leading-relaxed whitespace-pre-wrap">{block.content}</p>
			{/if}
		{/each}
	</div>
{/if}
