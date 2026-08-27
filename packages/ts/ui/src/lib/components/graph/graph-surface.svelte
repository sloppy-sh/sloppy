<script lang="ts">
	// A stand-in for the canvas DESIGN.md § "The canvas" describes. It is handed
	// exactly what the renderer will be handed and raises exactly what the
	// renderer will raise, drawn as rows so the graph is navigable meanwhile.
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { drawnNodes, type GraphSurfaceProps } from '@sloppy/graph';

	let { nodes, collapsed, lens, onOpenNode, onExpand, onCollapse }: GraphSurfaceProps = $props();

	/** Past this, indentation costs more width than the generation is worth. */
	const INDENT_STEPS = 6;

	const drawn = $derived(drawnNodes(nodes, collapsed));
	const shallowest = $derived(drawn.reduce((least, d) => Math.min(least, d.node.depth), 1));

	const branching = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after.
		const parents = new Set<string>();
		for (const { node } of drawn) if (node.parent) parents.add(node.parent);
		return parents;
	});
</script>

{#if drawn.length === 0}
	<p class="text-muted-foreground">Nothing here yet. Your first note opens the first branch.</p>
{:else}
	<ul class="space-y-0.5">
		{#each drawn as { node, collapsed: folded, folded: hidden } (node.ref)}
			<li
				class="flex items-center gap-1"
				style="padding-left: {Math.min(node.depth - shallowest, INDENT_STEPS) * 0.75}rem"
			>
				{#if folded || branching.has(node.ref)}
					<button
						type="button"
						aria-expanded={!folded}
						aria-label={folded ? `Expand ${node.address}` : `Collapse ${node.address}`}
						onclick={() => (folded ? onExpand(node.ref) : onCollapse(node.ref))}
						class="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
					>
						{#if folded}<ChevronRight class="size-4" />{:else}<ChevronDown class="size-4" />{/if}
					</button>
				{:else}
					<span class="size-9 shrink-0"></span>
				{/if}

				<button
					type="button"
					onclick={() => onOpenNode(node.ref)}
					class="flex min-h-11 min-w-0 flex-1 items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					<span class="shrink-0 address text-sm text-muted-foreground">{node.address}</span>
					<span class="min-w-0 flex-1 truncate">{node.title || 'Untitled'}</span>
					{#if lens}
						{@const value = node.labels[lens.dimension.name]}
						{#if value}
							<span class="shrink-0 text-xs" style="color: var(--facet-{lens.slot})">{value}</span>
						{/if}
					{/if}
					{#if hidden > 0}
						<span class="shrink-0 address text-xs text-muted-foreground">+{hidden}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
