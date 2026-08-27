<script lang="ts">
	// A stand-in for the block editor docs/ARCHITECTURE.md § "Blocks and ink"
	// describes: it shows a node's interior as the Markdown it is stored as, and
	// writes none of it.
	import type { BlockStackProps } from './contract.js';

	let { blocks }: BlockStackProps = $props();
</script>

{#if blocks.length === 0}
	<p class="text-sm text-muted-foreground">Nothing written here yet.</p>
{:else}
	<div class="space-y-5 select-text">
		{#each blocks as block (block.ref)}
			{#if block.type === 'ink'}
				<p class="text-sm text-muted-foreground">A drawing.</p>
			{:else}
				<p class="text-base leading-relaxed whitespace-pre-wrap">{block.content}</p>
			{/if}
		{/each}
	</div>
{/if}
