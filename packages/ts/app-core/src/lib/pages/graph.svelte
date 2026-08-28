<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';

	// Outside the component: the nav pill's destinations are real navigations, so
	// the graph is torn down on the way to settings and rebuilt on the way back,
	// and which branches the reader folded is their place in it.
	const folded = new SvelteSet<OwnedRef>();
</script>

<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The home surface: the whole graph, the tags it is lit by, and the note that
	// opens over it. DESIGN.md § Layout — the graph is the page.
	import Plus from '@lucide/svelte/icons/plus';
	import type { NodeView } from '@sloppy/types';
	import { GraphSurface, ResponsiveModal, TagRail } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { afterNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { nodes } from '../stores/nodes.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import { tags } from '../stores/tags.svelte.js';
	import Note from './node.svelte';
	import { nodeHref, refFromPath } from './routes.js';

	let loading = $state(!nodes.status().loaded);
	/** The graph itself is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** An action failed while the graph is fine; it sits beside the graph. */
	let refused = $state<string | null>(null);
	let creating = $state(false);
	/** What the rail covers, so the graph frames itself into what is left. */
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

	/**
	 * Only what the reader folded by hand: bounding the field is the surface's
	 * job, and a host that pre-collapses everything gets mega-nodes and none of
	 * the graph. Copied, so a fold reaches the surface as a new set.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after.
	const collapsed = $derived(new Set(folded));

	const selection = $derived(tags.selected);

	/** Notes carrying ANY of the selected tags, which is what the canvas lights. */
	const lit = $derived(
		selection.length === 0
			? 0
			: visible.filter((note) => note.tags.some((tag) => selection.includes(tag))).length
	);

	const summary = $derived(
		selection.length === 0
			? `${count(visible.length, 'note', 'notes')} across ${count(roots.length, 'branch', 'branches')}`
			: `${lit.toLocaleString()} of ${count(visible.length, 'note', 'notes')} lit up`
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
			const [, mine] = await Promise.all([tags.load(), nodes.load()]);
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

	// A note reached by its address arrives in the URL and nowhere else, at either
	// moment this page can arrive at one: mounting on it, or a navigation landing
	// on it — which settles `page.state` last, after any mount it caused.
	function openCited(): void {
		const cited = refFromPath(page.url.pathname);
		if (cited && !page.state.note) replaceState('', { note: cited });
	}

	onMount(() => {
		openCited();
		void loadGraph();
	});

	afterNavigate(openCited);

	// Re-runs as the cache fills, so a note reached by its address is never left
	// inside a branch the reader folded earlier.
	$effect(() => {
		let node = open ? nodes.get(open) : undefined;
		while (node?.parent) {
			folded.delete(node.parent);
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
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div class="viewport-fit relative">
	<h1 class="sr-only">Your graph</h1>

	{#if populated}
		<!-- DESIGN.md § "The canvas": never a scroller. It clears the chrome
		     rather than passing under it, because the graph frames itself to
		     whatever box it is given. -->
		<div class="clear-sysnav absolute inset-x-0 bottom-0" style:top="{railHeight}px">
			<GraphSurface
				nodes={visible}
				{collapsed}
				{selection}
				viewer={session.viewer?.did}
				focus={open ?? undefined}
				onOpenNode={show}
				onExpand={(ref) => folded.delete(ref)}
				onCollapse={(ref) => folded.add(ref)}
			/>
		</div>
	{:else}
		<div class="clear-sysnav absolute inset-0 overflow-y-auto px-3 sm:px-6">
			<div class="mx-auto w-full max-w-4xl pb-8">
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
				{:else}
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
				{/if}
			</div>
		</div>
	{/if}

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

				{#if tags.all.length > 0 || selection.length > 0}
					<TagRail tags={tags.all} selected={selection} onselect={(next) => tags.select(next)} />
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
