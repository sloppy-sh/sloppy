<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	// One node's interior. The shells hand down the two halves of its reference
	// because that is all a route can carry.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import {
		compareOrd,
		type BlockView,
		type CreateBlockRequest,
		type OwnedRef,
		type UpdateBlockRequest
	} from '@sloppy/types';
	import { BlockStack } from '@sloppy/ui';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { api } from '../api.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { serverMessage } from '../stores/errors.js';

	let { did, ulid }: { did: string; ulid: string } = $props();

	const ref = $derived(`${did}/${ulid}` as OwnedRef);
	const node = $derived(nodes.get(ref));
	const facets = $derived(Object.entries(node?.labels ?? {}));

	let blocks = $state<BlockView[]>([]);
	let loading = $state(true);
	let problem = $state<string | null>(null);

	const byOrd = (a: BlockView, b: BlockView) => compareOrd(a.ord, b.ord);

	$effect(() => {
		const opening = ref;
		let live = true;
		loading = true;
		problem = null;
		void (async () => {
			try {
				const [, stack] = await Promise.all([nodes.fetch(opening), api.listBlocks(opening)]);
				if (live) blocks = stack;
			} catch (error) {
				if (live) {
					problem =
						serverMessage(error) ?? 'Sloppy could not open this note. Try again in a moment.';
				}
			} finally {
				if (live) loading = false;
			}
		})();
		return () => {
			live = false;
		};
	});

	async function onCreate(request: CreateBlockRequest): Promise<BlockView> {
		const block = await api.createBlock(request);
		blocks = [...blocks, block].sort(byOrd);
		return block;
	}

	async function onUpdate(block: OwnedRef, request: UpdateBlockRequest): Promise<BlockView> {
		const saved = await api.updateBlock(block, request);
		blocks = blocks.map((b) => (b.ref === saved.ref ? saved : b)).sort(byOrd);
		return saved;
	}

	async function onRemove(block: OwnedRef): Promise<void> {
		await api.deleteBlock(block);
		blocks = blocks.filter((b) => b.ref !== block);
	}

	function onReorder(block: OwnedRef, after: OwnedRef | null): Promise<BlockView> {
		return onUpdate(block, { after });
	}
</script>

<svelte:head><title>{node?.title || 'Note'} · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-8 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 sm:px-8"
	>
		<a
			href="/"
			class="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		>
			<ArrowLeft class="size-4" />
			Graph
		</a>

		{#if loading}
			<div class="space-y-4">
				<Skeleton class="h-8 w-2/3" />
				<Skeleton class="h-24 w-full" />
			</div>
		{:else if problem}
			<p class="text-sm text-destructive" role="alert">{problem}</p>
		{:else if !node}
			<p class="text-muted-foreground">That note is not here.</p>
		{:else}
			<header class="space-y-3">
				<p class="address text-sm text-muted-foreground select-text">{node.address}</p>
				<h1 class="text-3xl font-semibold tracking-tight select-text">
					{node.title || 'Untitled'}
				</h1>
				{#if facets.length > 0}
					<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
						{#each facets as [dimension, value] (dimension)}
							<li>{dimension} · <span class="text-foreground">{value}</span></li>
						{/each}
					</ul>
				{/if}
			</header>

			<BlockStack {node} {blocks} {onCreate} {onUpdate} {onRemove} {onReorder} />
		{/if}
	</div>
</div>
