<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';

	// Outside the component: the nav pill's destinations are real navigations, so
	// the graph is torn down on the way to settings and rebuilt on the way back,
	// and which branches were open is the reader's place in it.
	const expanded = new SvelteSet<OwnedRef>();
</script>

<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The home surface: the whole graph, the lens it is read under, and the note
	// that opens over it. DESIGN.md § Layout — the graph is the page.
	import Plus from '@lucide/svelte/icons/plus';
	import type { GraphLens } from '@sloppy/graph';
	import type { NodeView } from '@sloppy/types';
	import { cn, GraphSurface, ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { labels } from '../stores/labels.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import Note from './node.svelte';
	import { nodeHref, refFromPath } from './routes.js';

	let loading = $state(!nodes.status().loaded);
	/** The graph itself is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** An action failed while the graph is fine; it sits beside the graph. */
	let refused = $state<string | null>(null);
	let creating = $state(false);
	let railHeight = $state(0);
	/** The note just written, whose title is still waiting to be given. */
	let naming = $state<OwnedRef | null>(null);

	const roots = $derived(nodes.region());
	const open = $derived(page.state.note ?? null);
	const openNode = $derived(open ? nodes.get(open) : undefined);
	const populated = $derived(!loading && !unreachable && roots.length > 0);

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

	async function loadGraph(): Promise<void> {
		// A branch already cached is drawn while the rest arrives; only a graph
		// that is not here yet is worth a skeleton.
		loading = !nodes.status().loaded;
		unreachable = null;
		try {
			const [, mine] = await Promise.all([labels.load(), nodes.load()]);
			// One branch missing would leave the counts under every mega-node wrong
			// with nothing to say so, which is worse than saying the graph is not here.
			await Promise.all(mine.map((root) => nodes.load({ origin: root.ref })));
		} catch (error) {
			unreachable =
				serverMessage(error) ?? 'Sloppy could not reach your graph. Try again in a moment.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		// A note reached by its address arrives in the URL and nowhere else; from
		// here on the history entry is the only place the open note is read from.
		const cited = refFromPath(page.url.pathname);
		if (cited && !page.state.note) replaceState('', { note: cited });
		void loadGraph();
	});

	// Re-runs as the cache fills, so a note reached by its address arrives with
	// the branch that leads to it already open.
	$effect(() => {
		let node = open ? nodes.get(open) : undefined;
		while (node?.parent) {
			expanded.add(node.parent);
			node = nodes.get(node.parent);
		}
	});

	function show(ref: OwnedRef, fresh = false): void {
		naming = fresh ? ref : null;
		pushState(nodeHref(ref), { note: ref });
	}

	/** Shallow, so the graph behind the note is never torn down and rebuilt. */
	function hide(): void {
		naming = null;
		replaceState('/', {});
	}

	/** A branch of its own. A note that continues one is written from inside it. */
	async function writeBranch(): Promise<void> {
		if (creating) return;
		creating = true;
		refused = null;
		try {
			show((await nodes.create({})).ref, true);
		} catch (error) {
			refused = serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			creating = false;
		}
	}

	const lensClass =
		'shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div class="viewport-fit relative">
	<!-- Scrolls because the surface still draws the graph as a list. DESIGN.md
	     § "The canvas": the canvas owns pan and zoom, and is never wrapped in
	     something that scrolls. -->
	<div
		class="clear-sysnav absolute inset-0 overflow-y-auto px-3 sm:px-6"
		style:padding-top="{populated ? railHeight : 0}px"
	>
		<div class="mx-auto w-full max-w-4xl pb-8">
			<h1 class="sr-only">Your graph</h1>

			{#if loading}
				<div class="space-y-2 px-2 pt-2">
					{#each Array.from({ length: 6 }, (_, row) => row) as row (row)}
						<Skeleton class="h-11 w-full" />
					{/each}
				</div>
			{:else if unreachable}
				<div class="mx-auto max-w-sm space-y-5 py-20 text-center">
					<p class="text-muted-foreground" role="alert">{unreachable}</p>
					<Button variant="outline" class="h-11" onclick={loadGraph}>Try again</Button>
				</div>
			{:else if roots.length === 0}
				<div class="mx-auto max-w-sm space-y-6 py-20 text-center">
					<p class="text-lg leading-relaxed">
						Your graph starts with one note, and everything else grows out of it.
					</p>
					<Button class="h-11" disabled={creating} onclick={writeBranch}>
						Write the first note
					</Button>
					{#if refused}
						<p class="text-sm text-destructive" role="alert">{refused}</p>
					{/if}
				</div>
			{:else}
				<GraphSurface
					nodes={visible}
					{collapsed}
					{lens}
					onOpenNode={show}
					onExpand={(ref) => expanded.add(ref)}
					onCollapse={(ref) => expanded.delete(ref)}
				/>
			{/if}
		</div>
	</div>

	{#if populated}
		<div
			bind:clientHeight={railHeight}
			class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-background via-background to-transparent pt-[max(0.75rem,env(safe-area-inset-top))] pb-5"
		>
			<div class="pointer-events-auto mx-auto w-full max-w-4xl space-y-2 px-3 sm:px-6">
				<div class="flex items-center gap-3">
					<p class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</p>
					<Button
						variant="outline"
						class="h-9 shrink-0 rounded-full"
						disabled={creating}
						onclick={writeBranch}
					>
						<Plus class="size-4" />
						New branch
					</Button>
				</div>

				{#if labels.dimensions.length > 0}
					<div
						class="scroll-fade-x -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"
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

				{#if refused}
					<p class="text-sm text-destructive" role="alert">{refused}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<ResponsiveModal
	open={open !== null}
	onOpenChange={(v) => {
		if (!v) hide();
	}}
	title={openNode?.title || 'Note'}
	headed={false}
	class="sm:max-w-2xl"
>
	{#if open}
		<Note ref={open} {naming} onOpen={show} onClose={hide} />
	{/if}
</ResponsiveModal>
