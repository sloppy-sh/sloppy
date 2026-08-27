<script lang="ts">
	// One note's interior, shown over the graph it belongs to. The address is at
	// the top because it is what a person cites and a peer resolves.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		compareOrd,
		type BlockView,
		type CreateBlockRequest,
		type OwnedRef,
		type UpdateBlockRequest
	} from '@sloppy/types';
	import { BlockStack } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onDestroy } from 'svelte';
	import { api } from '../api.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { serverMessage } from '../stores/errors.js';

	let {
		ref,
		naming = false,
		onOpen,
		onClose
	}: {
		ref: OwnedRef;
		/** This note has only just been written; the caret belongs in its title. */
		naming?: boolean;
		onOpen: (ref: OwnedRef, fresh?: boolean) => void;
		onClose: () => void;
	} = $props();

	const node = $derived(nodes.get(ref));
	const children = $derived(nodes.children(ref));
	const facets = $derived(Object.entries(node?.labels ?? {}));

	let blocks = $state<BlockView[]>([]);
	let loading = $state(true);
	let unreachable = $state<string | null>(null);
	let unsaved = $state<string | null>(null);
	let adding = $state(false);
	let refused = $state<string | null>(null);
	let titleField = $state<HTMLTextAreaElement | null>(null);

	/** Kept until it is stored, so a save that fails still has it to try again. */
	let typed = $state<{ ref: OwnedRef; title: string } | null>(null);
	const title = $derived(typed?.ref === ref ? typed.title : (node?.title ?? ''));

	const byOrd = (a: BlockView, b: BlockView) => compareOrd(a.ord, b.ord);

	$effect(() => {
		if (naming) titleField?.focus();
	});

	/** A title wraps rather than scrolling out of sight, so the box follows it. */
	function fitTitle(field: HTMLTextAreaElement): void {
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	$effect(() => {
		if (node && titleField) fitTitle(titleField);
	});

	// Dismissing the sheet with the keyboard tears the field down without ever
	// blurring it, and what was typed into it is still worth keeping.
	onDestroy(() => void saveTitle());

	$effect(() => {
		const opening = ref;
		let live = true;
		loading = true;
		unreachable = null;
		void (async () => {
			try {
				const [, stack] = await Promise.all([nodes.fetch(opening), api.listBlocks(opening)]);
				if (live) blocks = stack;
			} catch (error) {
				if (live) {
					unreachable =
						serverMessage(error) ?? 'Sloppy could not read this note. Close it and open it again.';
				}
			} finally {
				if (live) loading = false;
			}
		})();
		return () => {
			live = false;
		};
	});

	async function saveTitle(): Promise<void> {
		const draft = typed;
		if (!draft || draft.ref !== ref || draft.title === node?.title) return;
		try {
			await nodes.update(ref, { title: draft.title });
			if (typed === draft) typed = null;
			unsaved = null;
		} catch (error) {
			unsaved = serverMessage(error) ?? 'Sloppy could not save that title. Try again in a moment.';
		}
	}

	async function writeChild(): Promise<void> {
		if (adding) return;
		adding = true;
		refused = null;
		try {
			onOpen((await nodes.create({ parent: ref })).ref, true);
		} catch (error) {
			refused = serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head><title>{node?.title || 'Note'} · Sloppy</title></svelte:head>

<div class="flex min-h-0 flex-col gap-7 px-2 pt-2 pb-1 sm:px-1">
	<!-- First, so the sheet opens on a way out rather than in the title field,
	     which on a phone would raise the keyboard over a note you came to read. -->
	<button
		type="button"
		onclick={onClose}
		class="-ml-2 -mb-4 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
	>
		<ArrowLeft class="size-4" />
		Graph
	</button>

	{#if loading && !node}
		<div class="space-y-4">
			<Skeleton class="h-4 w-16" />
			<Skeleton class="h-9 w-2/3" />
			<Skeleton class="h-24 w-full" />
		</div>
	{:else if unreachable && !node}
		<p class="py-8 text-center text-muted-foreground" role="alert">{unreachable}</p>
	{:else if !node}
		<p class="py-8 text-center text-muted-foreground">
			That note is not here. Whoever wrote it may have taken it down.
		</p>
	{:else}
		<header class="space-y-3">
			<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<p class="address text-sm text-foreground/70 select-text">{node.address}</p>
				{#each facets as [dimension, value] (dimension)}
					<p class="text-xs text-muted-foreground">
						{dimension} · <span class="text-foreground">{value}</span>
					</p>
				{/each}
			</div>

			<textarea
				bind:this={titleField}
				value={title}
				rows="1"
				oninput={(e) => {
					typed = { ref, title: e.currentTarget.value };
					fitTitle(e.currentTarget);
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				onblur={saveTitle}
				placeholder="Untitled"
				maxlength="512"
				aria-label="Title"
				class="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl leading-snug font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:outline-none"
			></textarea>

			{#if unsaved}<p class="text-sm text-destructive" role="alert">{unsaved}</p>{/if}
			{#if unreachable}<p class="text-sm text-destructive" role="alert">{unreachable}</p>{/if}
		</header>

		<BlockStack
			{node}
			{blocks}
			onCreate={async (request: CreateBlockRequest) => {
				const block = await api.createBlock(request);
				blocks = [...blocks, block].sort(byOrd);
				return block;
			}}
			onUpdate={async (block: OwnedRef, request: UpdateBlockRequest) => {
				const saved = await api.updateBlock(block, request);
				blocks = blocks.map((b) => (b.ref === saved.ref ? saved : b)).sort(byOrd);
				return saved;
			}}
			onRemove={async (block: OwnedRef) => {
				await api.deleteBlock(block);
				blocks = blocks.filter((b) => b.ref !== block);
			}}
			onReorder={async (block: OwnedRef, after: OwnedRef | null) => {
				const saved = await api.updateBlock(block, { after });
				blocks = blocks.map((b) => (b.ref === saved.ref ? saved : b)).sort(byOrd);
				return saved;
			}}
		/>

		<div class="space-y-3 border-t border-border pt-6">
			{#if children.length > 0}
				<h2 class="text-sm font-medium text-muted-foreground">Continues into</h2>
				<ul class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto">
					{#each children as child (child.ref)}
						<li>
							<button
								type="button"
								onclick={() => onOpen(child.ref)}
								class="flex min-h-11 w-full items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
							>
								<span class="address shrink-0 text-sm text-muted-foreground">{child.address}</span>
								<span class="min-w-0 flex-1 truncate">{child.title || 'Untitled'}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<Button variant="outline" class="h-11" disabled={adding} onclick={writeChild}>
				<Plus class="size-4" />
				{children.length > 0 ? 'Another note under this' : 'Write a note under this'}
			</Button>

			{#if refused}<p class="text-sm text-destructive" role="alert">{refused}</p>{/if}
		</div>
	{/if}
</div>
