<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// The facet axis, where a reader owns it: the dimensions notes are sorted
	// along, the one the graph is coloured by, and the notes an intersection of
	// facets picks out of every branch at once.
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { LabelDimensionView, LabelSet, NodeView, OwnedRef } from '@sloppy/types';
	import {
		cn,
		ConfirmModal,
		DimensionEditor,
		FacetLegend,
		FacetValues,
		LabelPicker,
		ResponsiveModal,
		valueChanges,
		type DimensionDraft
	} from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { serverMessage } from '../stores/errors.js';
	import { labels } from '../stores/labels.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { nodeHref } from './routes.js';

	/** Enough to see what an intersection caught without rendering a graph's
	 *  worth of rows. */
	const LISTED = 50;

	let loading = $state(true);
	let unreachable = $state<string | null>(null);
	/** An act failed while the page is fine; it sits beside the act. */
	let refused = $state<string | null>(null);
	let editing = $state<LabelDimensionView | undefined>(undefined);
	let editorOpen = $state(false);
	let editorRefused = $state<string | null>(null);
	let removing = $state<LabelDimensionView | null>(null);
	let confirming = $state(false);
	let query = $state<LabelSet>({});
	let labelling = $state<OwnedRef | null>(null);
	let labelRefused = $state<string | null>(null);

	const dimensions = $derived(labels.dimensions);
	const lens = $derived(labels.lens);
	const labelled = $derived(labelling ? nodes.get(labelling) : undefined);

	/** Depth-first from the roots, which is address order without re-deriving it. */
	const all = $derived.by(() => {
		const out: NodeView[] = [];
		const walk = (list: NodeView[]) => {
			for (const node of list) {
				out.push(node);
				walk(nodes.children(node.ref));
			}
		};
		walk(nodes.region());
		return out;
	});

	/** Notes carrying each declared value, by dimension. A value no dimension
	 *  declares is counted nowhere, which is where "No value" gets it back. */
	const counts = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after; the derived IS the reactivity.
		const out = new Map<string, Map<string, number>>();
		for (const dimension of dimensions) {
			out.set(dimension.name, new Map(dimension.values.map((value) => [value, 0])));
		}
		for (const node of all) {
			for (const [name, value] of Object.entries(node.labels)) {
				const per = out.get(name);
				const held = per?.get(value);
				if (per && held !== undefined) per.set(value, held + 1);
			}
		}
		return out;
	});

	const asked = $derived(Object.entries(query));
	/** `null` where nothing has been asked, which is not the same as no answer. */
	const matches = $derived(
		asked.length === 0
			? null
			: all.filter((node) => asked.every(([name, value]) => node.labels[name] === value))
	);
	const branches = $derived(matches ? new Set(matches.map((node) => node.origin)).size : 0);

	function carrying(dimension: string): number {
		let held = 0;
		for (const count of counts.get(dimension)?.values() ?? []) held += count;
		return held;
	}

	function count(n: number, one: string, many: string): string {
		return `${n.toLocaleString()} ${n === 1 ? one : many}`;
	}

	async function read(fresh: boolean): Promise<void> {
		loading = !labels.loaded;
		unreachable = null;
		try {
			const ask = fresh ? nodes.reload({}) : nodes.load();
			const [, mine] = await Promise.all([fresh ? labels.reload() : labels.load(), ask]);
			await Promise.all(
				mine.map((root) =>
					fresh ? nodes.reload({ origin: root.ref }) : nodes.load({ origin: root.ref })
				)
			);
		} catch (error) {
			unreachable =
				serverMessage(error) ?? 'Sloppy could not reach your labels. Try again in a moment.';
		} finally {
			loading = false;
		}
	}

	onMount(() => void read(false));

	function declare(): void {
		editing = undefined;
		editorRefused = null;
		editorOpen = true;
	}

	function edit(dimension: LabelDimensionView): void {
		editing = dimension;
		editorRefused = null;
		editorOpen = true;
	}

	/**
	 * A value the reader renamed has to arrive on the notes before the old name
	 * leaves the dimension, because dropping a value notes still carry is
	 * refused — and rightly: those labels are the author's.
	 */
	async function save(draft: DimensionDraft): Promise<void> {
		const target = editing;
		editorRefused = null;
		try {
			const { after, renames, bridge } = valueChanges(target?.values ?? [], draft.values);
			if (!target) {
				await labels.create({ name: draft.name, values: after, color_slot: draft.color_slot });
				return;
			}
			if (renames.length > 0) {
				await labels.update(target.ref, { values: bridge });
				for (const { from, to } of renames) {
					await Promise.all(
						all
							.filter((node) => node.labels[target.name] === from)
							.map((node) =>
								nodes.update(node.ref, { labels: { ...node.labels, [target.name]: to } })
							)
					);
				}
			}
			const renamed = draft.name !== target.name;
			await labels.update(target.ref, {
				name: draft.name,
				values: after,
				color_slot: draft.color_slot
			});
			// The API carries the key across every note that held it, so what is
			// cached here is a set of stale labels until they are read again.
			if (renamed) await read(true);
		} catch (error) {
			editorRefused =
				serverMessage(error) ?? 'Sloppy could not save that dimension. Try again in a moment.';
			throw error;
		}
	}

	function confirmRemove(dimension: LabelDimensionView): void {
		removing = dimension;
		refused = null;
		confirming = true;
	}

	async function remove(): Promise<void> {
		const target = removing;
		if (!target) return;
		try {
			await labels.remove(target.ref);
			delete query[target.name];
			await read(true);
		} catch (error) {
			refused =
				serverMessage(error) ?? 'Sloppy could not remove that dimension. Try again in a moment.';
			throw error;
		}
	}

	function ask(dimension: string, value: string | null): void {
		if (value === null) delete query[dimension];
		else query[dimension] = value;
	}

	async function assign(next: LabelSet): Promise<void> {
		const ref = labelling;
		if (!ref) return;
		labelRefused = null;
		try {
			await nodes.update(ref, { labels: next });
		} catch (error) {
			labelRefused = serverMessage(error) ?? null;
			throw error;
		}
	}
</script>

<svelte:head><title>Labels · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-10 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 sm:px-8"
	>
		<header class="space-y-2">
			<h1 class="text-3xl font-semibold tracking-tight">Labels</h1>
			<p class="text-sm text-muted-foreground">
				The dimensions your notes are sorted along, and the values each one can take.
			</p>
		</header>

		{#if loading}
			<div class="space-y-3">
				{#each Array.from({ length: 3 }, (_, row) => row) as row (row)}
					<Skeleton class="h-24 w-full" />
				{/each}
			</div>
		{:else if unreachable}
			<div class="mx-auto max-w-sm space-y-5 py-16 text-center">
				<p class="text-muted-foreground" role="alert">{unreachable}</p>
				<Button variant="outline" class="h-11" onclick={() => read(true)}>Try again</Button>
			</div>
		{:else if dimensions.length === 0}
			<div class="mx-auto max-w-sm space-y-6 py-16 text-center">
				<p class="text-lg leading-relaxed">
					A dimension is one question you sort notes by — where they came from, how far along they
					are — and the answers it allows.
				</p>
				<Button class="h-11" onclick={declare}>Add your first dimension</Button>
			</div>
		{:else}
			<section class="space-y-4">
				<div class="flex items-baseline justify-between gap-3">
					<h2 class="text-lg font-medium">Dimensions</h2>
					<Button variant="outline" class="h-9 rounded-full" onclick={declare}>
						<Plus class="size-4" />
						New
					</Button>
				</div>

				<ul class="space-y-3">
					{#each dimensions as dimension (dimension.ref)}
						{@const slot = labels.slotFor(dimension.name)}
						{@const reading = lens?.ref === dimension.ref}
						{@const held = carrying(dimension.name)}
						<li class="space-y-3 rounded-lg border border-border bg-card p-4">
							<div class="flex items-start gap-3">
								<span
									aria-hidden="true"
									class="mt-1.5 size-2.5 shrink-0 rounded-full bg-current"
									style:color={slot === undefined ? undefined : `var(--facet-${slot})`}
								></span>
								<div class="min-w-0 flex-1">
									<p class="font-medium">{dimension.name}</p>
									<p class="text-sm text-muted-foreground">
										{count(held, 'note', 'notes')} sorted along it
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									class="size-11 shrink-0"
									aria-label="Edit {dimension.name}"
									onclick={() => edit(dimension)}
								>
									<Pencil class="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="size-11 shrink-0"
									aria-label="Delete {dimension.name}"
									onclick={() => confirmRemove(dimension)}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>

							{#if reading && slot !== undefined}
								<FacetLegend
									{dimension}
									{slot}
									counts={counts.get(dimension.name) ?? new Map()}
									unlabelled={all.length - held}
								/>
							{:else if dimension.values.length > 0}
								<p class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
									{#each dimension.values as value (value)}<span>{value}</span>{/each}
								</p>
							{:else}
								<p class="text-sm text-muted-foreground">
									No values yet, so nothing can be sorted along it.
								</p>
							{/if}

							<button
								type="button"
								aria-pressed={reading}
								onclick={() => labels.setLens(reading ? null : dimension.name)}
								style={reading && slot !== undefined ? `color: var(--facet-${slot})` : undefined}
								class={cn(
									'inline-flex min-h-11 items-center rounded-md text-sm transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
									reading ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
								)}
							>
								{reading ? 'Colouring the graph' : 'Colour the graph by this'}
							</button>
						</li>
					{/each}
				</ul>

				{#if refused}<p class="text-sm text-destructive" role="alert">{refused}</p>{/if}
			</section>

			<section class="space-y-4">
				<div class="space-y-1">
					<h2 class="text-lg font-medium">Find notes</h2>
					<p class="text-sm text-muted-foreground">
						Answer more than one dimension and you get the notes in all of them at once, from
						wherever they sit in the graph.
					</p>
				</div>

				{#each dimensions as dimension (dimension.ref)}
					<div class="space-y-1.5">
						<p class="text-sm font-medium">{dimension.name}</p>
						<FacetValues
							{dimension}
							slot={labels.slotFor(dimension.name)}
							value={query[dimension.name] ?? null}
							emptyLabel="Any"
							onchange={(value) => ask(dimension.name, value)}
						/>
					</div>
				{/each}

				{#if matches}
					<div class="space-y-2 border-t border-border pt-4">
						<p class="text-sm text-muted-foreground">
							{count(matches.length, 'note', 'notes')} across {count(
								branches,
								'branch',
								'branches'
							)}
						</p>
						<ul class="space-y-0.5">
							{#each matches.slice(0, LISTED) as node (node.ref)}
								<li class="flex items-center gap-2">
									<a
										href={nodeHref(node.ref)}
										class="flex min-h-11 min-w-0 flex-1 items-baseline gap-3 rounded-md px-2 transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
									>
										<span class="address shrink-0 text-sm text-muted-foreground">
											{node.address}
										</span>
										<span class="min-w-0 flex-1 truncate">{node.title || 'Untitled'}</span>
									</a>
									<Button
										variant="ghost"
										class="h-11 shrink-0 px-3 text-sm"
										onclick={() => {
											labelRefused = null;
											labelling = node.ref;
										}}
									>
										Labels
									</Button>
								</li>
							{/each}
						</ul>
						{#if matches.length > LISTED}
							<p class="px-2 text-sm text-muted-foreground">
								{count(matches.length - LISTED, 'more note', 'more notes')} not listed.
							</p>
						{/if}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>

<DimensionEditor bind:open={editorOpen} dimension={editing} onsave={save} refused={editorRefused} />

<ConfirmModal
	bind:open={confirming}
	title="Delete {removing?.name}?"
	description={removing && carrying(removing.name) > 0
		? `${count(carrying(removing.name), 'note is', 'notes are')} sorted along it. Those notes stay; that label leaves them.`
		: 'Nothing is sorted along it yet.'}
	confirmLabel="Delete"
	onconfirm={remove}
/>

<ResponsiveModal
	open={labelling !== null}
	onOpenChange={(up) => {
		if (!up) labelling = null;
	}}
	title={labelled?.title || 'Note'}
	description="One value per dimension."
	class="sm:max-w-lg"
>
	{#if labelled}
		<div class="space-y-4 px-2 pt-4">
			<p class="address text-sm text-muted-foreground select-text">{labelled.address}</p>
			<LabelPicker
				dimensions={labels.dimensions}
				labels={labelled.labels}
				slotFor={(name) => labels.slotFor(name)}
				onassign={assign}
				refused={labelRefused}
			/>
		</div>
	{/if}
</ResponsiveModal>
