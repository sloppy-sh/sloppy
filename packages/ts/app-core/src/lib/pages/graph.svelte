<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The home surface: the whole graph, and the lens it is read under.
	import type { GraphLens } from '@sloppy/graph';
	import type { NodeView, OwnedRef } from '@sloppy/types';
	import { cn, GraphSurface } from '@sloppy/ui';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { labels } from '../stores/labels.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { serverMessage } from '../stores/errors.js';

	const expanded = new SvelteSet<OwnedRef>();

	let loading = $state(true);
	let problem = $state<string | null>(null);

	const roots = $derived(nodes.region());

	/** Depth-first from the roots, which is address order without re-deriving it. */
	const visible = $derived.by(() => {
		const out: NodeView[] = [];
		const walk = (list: NodeView[]) => {
			for (const node of list) {
				out.push(node);
				walk(nodes.children(node.ref));
			}
		};
		walk(roots);
		return out;
	});

	const collapsed = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after.
		const folded = new Set<OwnedRef>();
		for (const node of visible) {
			if (!expanded.has(node.ref) && nodes.children(node.ref).length > 0) folded.add(node.ref);
		}
		return folded;
	});

	const lens = $derived.by((): GraphLens | null => {
		const dimension = labels.lens;
		if (!dimension) return null;
		const slot = labels.slotFor(dimension.name);
		return slot === undefined ? null : { dimension, slot };
	});

	const summary = $derived(
		`${count(visible.length, 'note', 'notes')} across ${count(roots.length, 'branch', 'branches')}`
	);

	function count(n: number, one: string, many: string): string {
		return `${n.toLocaleString()} ${n === 1 ? one : many}`;
	}

	function nodeHref(ref: OwnedRef): string {
		const cut = ref.lastIndexOf('/');
		return `/n/${encodeURIComponent(ref.slice(0, cut))}/${encodeURIComponent(ref.slice(cut + 1))}`;
	}

	onMount(async () => {
		try {
			const [, mine] = await Promise.all([labels.load(), nodes.load()]);
			await Promise.all(mine.map((root) => nodes.load({ origin: root.ref })));
		} catch (error) {
			problem = serverMessage(error) ?? 'Sloppy could not reach your graph. Try again in a moment.';
		} finally {
			loading = false;
		}
	});

	const lensClass =
		'shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div class="viewport-fit flex flex-col">
	<header class="shrink-0 space-y-3 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-3 sm:px-8">
		<h1 class="sr-only">Your graph</h1>
		{#if !loading && !problem}
			<p class="text-sm text-muted-foreground">{summary}</p>
		{/if}

		{#if labels.dimensions.length > 0}
			<div
				class="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 scroll-fade-x [scrollbar-width:none]"
			>
				<button
					type="button"
					aria-pressed={lens === null}
					onclick={() => labels.setLens(null)}
					class={cn(
						lensClass,
						lens === null
							? 'border-foreground/30'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					)}
				>
					No lens
				</button>
				{#each labels.dimensions as dimension (dimension.ref)}
					{@const on = lens?.dimension.ref === dimension.ref}
					<button
						type="button"
						aria-pressed={on}
						onclick={() => labels.setLens(dimension.name)}
						style={on && lens ? `color: var(--facet-${lens.slot})` : undefined}
						class={cn(
							lensClass,
							on
								? 'border-current'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						)}
					>
						{dimension.name}
					</button>
				{/each}
			</div>
		{/if}
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-3 pt-1 clear-sysnav scroll-fade-y sm:px-6">
		{#if loading}
			<div class="space-y-2 px-2">
				{#each Array.from({ length: 6 }, (_, row) => row) as row (row)}
					<Skeleton class="h-11 w-full" />
				{/each}
			</div>
		{:else if problem}
			<p class="px-2 text-sm text-destructive" role="alert">{problem}</p>
		{:else}
			<GraphSurface
				nodes={visible}
				{collapsed}
				{lens}
				onOpenNode={(ref) => void goto(nodeHref(ref))}
				onExpand={(ref) => expanded.add(ref)}
				onCollapse={(ref) => expanded.delete(ref)}
			/>
		{/if}
	</div>
</div>
