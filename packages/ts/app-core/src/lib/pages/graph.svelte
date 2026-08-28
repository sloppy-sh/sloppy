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
	import Hash from '@lucide/svelte/icons/hash';
	import Plus from '@lucide/svelte/icons/plus';
	import { RootAddressSchema, type NodeView } from '@sloppy/types';
	import { GraphSurface, ResponsiveModal, TagRail } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
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
	/** Naming a branch's number, which is the one address a person picks. */
	let numbering = $state(false);
	let branchNumber = $state('');
	let numberRefused = $state<string | null>(null);
	/** What the rail covers, so the graph frames itself into what is left. */
	let railHeight = $state(0);
	/** The note just written, whose title is still waiting to be given. */
	let naming = $state<OwnedRef | null>(null);
	/** The note a link is being pointed FROM, while the graph is the picker. */
	let pointing = $state<OwnedRef | null>(null);
	/** Where the reader has got to while looking for the note they mean: the one
	 *  they are pointing from, and then whichever mega-node they opened. */
	let looking = $state<OwnedRef | null>(null);
	let pointRefused = $state<string | null>(null);
	let linking = $state(false);

	const roots = $derived(nodes.region());
	const open = $derived(page.state.note ?? null);
	const openNode = $derived(open ? nodes.get(open) : undefined);
	const pointingNote = $derived(pointing ? nodes.get(pointing) : undefined);
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

	/** The note steps aside so the graph it belongs to can answer the question. */
	function pointFrom(from: OwnedRef): void {
		pointRefused = null;
		pointing = from;
		looking = from;
		hide();
	}

	function stopPointing(): void {
		const from = pointing;
		pointing = null;
		looking = null;
		pointRefused = null;
		if (from) show(from);
	}

	/** Tapping a note it already points at is not a second link; it is the
	 *  reader saying the one they want is the one already there. */
	async function pointAt(target: OwnedRef): Promise<void> {
		const from = pointing;
		const note = from ? nodes.get(from) : undefined;
		if (!from || !note || linking) return;
		linking = true;
		pointRefused = null;
		try {
			if (!note.links.includes(target)) {
				await nodes.update(from, { links: [...note.links, target] });
			}
		} catch (error) {
			pointRefused =
				serverMessage(error) ?? 'Sloppy could not add that link. Try again in a moment.';
			return;
		} finally {
			linking = false;
		}
		pointing = null;
		looking = null;
		show(from);
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

	function startNumbering(): void {
		branchNumber = '';
		numberRefused = null;
		numbering = true;
	}

	/** Through the schema the API refuses by, so both say the same thing. */
	async function writeNumberedBranch(): Promise<void> {
		if (creating) return;
		const picked = RootAddressSchema.safeParse(branchNumber.trim());
		if (!picked.success) {
			numberRefused = picked.error.issues[0].message;
			return;
		}
		creating = true;
		numberRefused = null;
		try {
			const written = await nodes.create({
				from: { relation: 'root', address: picked.data }
			});
			numbering = false;
			show(written.ref, true);
		} catch (error) {
			numberRefused =
				serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (pointing && event.key === 'Escape') stopPointing();
	}}
/>

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
				focus={open ?? looking ?? undefined}
				picking={pointing && pointingNote
					? {
							from: pointing,
							taken: new Set(pointingNote.links),
							onPick: (ref) => void pointAt(ref)
						}
					: undefined}
				onOpenNode={show}
				onExpand={(ref) => {
					folded.delete(ref);
					if (pointing) looking = ref;
				}}
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
						<div class="flex flex-col items-center gap-2">
							<Button class="h-11" disabled={creating} onclick={writeBranch}>
								Write the first note
							</Button>
							<Button variant="ghost" class="h-11" disabled={creating} onclick={startNumbering}>
								Number it yourself
							</Button>
						</div>
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
				{#if pointing}
					<div class="flex items-center gap-3">
						<p class="min-w-0 flex-1 text-sm">
							Tap a note to link it to <span class="address">{pointingNote?.address}</span>
						</p>
						<Button
							variant="outline"
							class="h-9 shrink-0 rounded-full"
							disabled={linking}
							onclick={stopPointing}
						>
							Never mind
						</Button>
					</div>

					{#if pointRefused}
						<p class="text-sm text-destructive" role="alert">{pointRefused}</p>
					{/if}
				{:else}
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
						<Button
							variant="ghost"
							size="icon"
							class="size-9 shrink-0 rounded-full"
							aria-label="Number a new branch"
							disabled={creating}
							onclick={startNumbering}
						>
							<Hash class="size-4" />
						</Button>
					</div>
				{/if}

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
	bind:open={numbering}
	title="Number a new branch"
	description="Everything you write under it grows from the number you pick."
>
	<div class="space-y-3 px-2 pt-4">
		<Input
			bind:value={branchNumber}
			class="h-11"
			inputmode="numeric"
			autocomplete="off"
			placeholder="7"
			aria-label="Number"
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				void writeNumberedBranch();
			}}
		/>

		{#if numberRefused}
			<p class="text-sm text-destructive" role="alert">{numberRefused}</p>
		{/if}

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="outline"
				class="h-11 sm:h-9"
				disabled={creating}
				onclick={() => (numbering = false)}
			>
				Cancel
			</Button>
			<Button
				class="h-11 sm:h-9"
				disabled={creating || branchNumber.trim() === ''}
				onclick={writeNumberedBranch}
			>
				Write it
			</Button>
		</div>
	</div>
</ResponsiveModal>

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
		<Note ref={open} {naming} onOpen={show} onLinkOnGraph={() => pointFrom(open)} onClose={hide} />
	{/if}
</ResponsiveModal>
