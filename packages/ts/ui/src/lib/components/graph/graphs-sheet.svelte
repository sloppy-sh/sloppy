<script lang="ts" module>
	import { noteLabel, type OwnedRef } from '@sloppy/types';

	/** One of somebody's graphs, as this sheet lists it. */
	export interface GraphChoice {
		ref: OwnedRef;
		title: string;
	}

	/** A branch its author deleted and can still put back. */
	export interface DeletedChoice {
		ref: OwnedRef;
		/** The number they cite it by, which is how they will recognise it.
		 *  Absent on a branch with none; the title names it. */
		address?: string;
		/** The graph it comes back into. An address only means one thing inside one. */
		graph: OwnedRef;
		title: string;
		/** The root and everything that comes back with it. */
		notes: number;
		/** How long is left to put it back, in the words the row shows. */
		within: string;
	}
</script>

<script lang="ts">
	// The graphs a person keeps: the one they are in, the ones standing beside it
	// on the canvas, and the way to open another. DESIGN.md § "Several graphs on
	// one canvas".
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		graphs,
		current,
		home,
		alsoUp,
		full = false,
		busy = false,
		says = null,
		deleted = [],
		publishedFrom = undefined,
		onEnter,
		onToggle,
		onOpen,
		onRename,
		onRemove,
		onRestore,
		onShow
	}: {
		open?: boolean;
		graphs: readonly GraphChoice[];
		/** The one the reader is in, which is always on the canvas. */
		current: OwnedRef;
		/** The one they started with. It is where a note that names no graph
		 *  goes, so it is the one graph that cannot be closed. */
		home: OwnedRef;
		/** The others standing on the canvas beside it. */
		alsoUp: ReadonlySet<OwnedRef>;
		/** No more will fit on the canvas, so putting one up means taking one down. */
		full?: boolean;
		busy?: boolean;
		/** Why the last thing asked for did not happen. */
		says?: string | null;
		/** Newest first. Empty leaves the section off the sheet entirely. */
		deleted?: readonly DeletedChoice[];
		/** The graphs somebody has published a branch out of. Absent is not
		 *  knowing, and closing then says the consequence rather than withhold
		 *  it. */
		publishedFrom?: ReadonlySet<OwnedRef>;
		onEnter: (ref: OwnedRef) => void;
		onToggle: (ref: OwnedRef) => void;
		/** Rejects with an `Error` whose `message` is already fit to show. */
		onOpen: (title: string) => Promise<void>;
		onRename: (ref: OwnedRef, title: string) => Promise<void>;
		onRemove?: (ref: OwnedRef) => Promise<void>;
		onRestore?: (ref: OwnedRef) => Promise<void>;
		/** The sheet has just opened, and what it lists is worth asking for again. */
		onShow?: () => void;
	} = $props();

	let opening = $state('');
	let naming = $state<{ ref: OwnedRef; title: string } | null>(null);
	let refused = $state<string | null>(null);
	let working = $state(false);
	let putting = $state<OwnedRef | null>(null);
	let closing = $state<GraphChoice | null>(null);
	let confirming = $state(false);
	let closeRefused = $state<string | null>(null);

	$effect(() => {
		if (open) untrack(() => onShow?.());
	});

	const closeSays = $derived(
		closing && publishedFrom && !publishedFrom.has(closing.ref)
			? 'The notes in it go with it, and they cannot be put back.'
			: 'The notes in it go with it, and they cannot be put back. Whoever already has a branch you published from it keeps their copy.'
	);

	function nameOf(graph: GraphChoice | DeletedChoice): string {
		return graph.title || 'Untitled';
	}

	function graphHolding(branch: DeletedChoice): string {
		const held = graphs.find((graph) => graph.ref === branch.graph);
		return held ? nameOf(held) : 'Untitled';
	}

	async function putBack(branch: DeletedChoice): Promise<void> {
		if (!onRestore || putting !== null) return;
		putting = branch.ref;
		try {
			await act(() => onRestore(branch.ref));
		} finally {
			putting = null;
		}
	}

	async function act(what: () => Promise<void>): Promise<boolean> {
		if (working) return false;
		working = true;
		refused = null;
		try {
			await what();
			return true;
		} catch (error) {
			refused = error instanceof Error && error.message ? error.message : 'That did not work.';
			return false;
		} finally {
			working = false;
		}
	}

	async function openGraph(): Promise<void> {
		const title = opening.trim();
		if (title === '') return;
		if (await act(() => onOpen(title))) {
			opening = '';
			open = false;
		}
	}

	async function closeGraph(): Promise<void> {
		const graph = closing;
		if (!graph || !onRemove) return;
		closeRefused = null;
		try {
			await onRemove(graph.ref);
		} catch (error) {
			closeRefused = error instanceof Error && error.message ? error.message : 'That did not work.';
			throw error;
		}
		closing = null;
	}

	async function renameGraph(): Promise<void> {
		const asked = naming;
		if (!asked || asked.title.trim() === '') return;
		if (await act(() => onRename(asked.ref, asked.title.trim()))) naming = null;
	}
</script>

<ResponsiveModal
	bind:open
	title="Your graphs"
	description="Each one numbers its own thinking from 1."
>
	<div class="space-y-6 px-2 pt-4 pb-2">
		<ul class="space-y-1">
			{#each graphs as graph (graph.ref)}
				{@const here = graph.ref === current}
				{@const up = here || alsoUp.has(graph.ref)}
				<li class="flex items-center gap-2">
					{#if naming?.ref === graph.ref}
						<Input
							bind:value={naming.title}
							class="h-11 flex-1"
							autocomplete="off"
							maxlength={512}
							aria-label="Name"
							onkeydown={(e) => {
								if (e.key !== 'Enter') return;
								e.preventDefault();
								void renameGraph();
							}}
						/>
						<Button
							variant="outline"
							class="h-11 shrink-0"
							disabled={working || naming.title.trim() === ''}
							onclick={renameGraph}
						>
							Save
						</Button>
					{:else}
						<button
							type="button"
							aria-current={here ? 'true' : undefined}
							class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
							onclick={() => {
								open = false;
								onEnter(graph.ref);
							}}
						>
							<span class="w-4 shrink-0 text-muted-foreground">
								{#if here}<Check class="size-4" aria-hidden="true" />{/if}
							</span>
							<span class="min-w-0 flex-1 truncate">{nameOf(graph)}</span>
						</button>
						<Button
							variant={up ? 'secondary' : 'ghost'}
							class="h-9 shrink-0 rounded-full text-xs"
							disabled={here || busy || (full && !up)}
							aria-label={up
								? `Take ${nameOf(graph)} off the canvas`
								: `Show ${nameOf(graph)} beside this one`}
							onclick={() => onToggle(graph.ref)}
						>
							{up ? 'On the canvas' : 'Show it too'}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 shrink-0 text-muted-foreground"
							aria-label={`Rename ${nameOf(graph)}`}
							onclick={() => {
								refused = null;
								naming = { ref: graph.ref, title: graph.title };
							}}
						>
							<Pencil class="size-4" />
						</Button>
						{#if onRemove && graph.ref !== home}
							<Button
								variant="ghost"
								size="icon"
								class="size-9 shrink-0 text-muted-foreground"
								aria-label={`Close ${nameOf(graph)}`}
								onclick={() => {
									closeRefused = null;
									closing = graph;
									confirming = true;
								}}
							>
								<Trash2 class="size-4" />
							</Button>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>

		{#if full}
			<p class="px-2 text-xs text-muted-foreground">
				That is as many as one canvas holds. Take one down to show another.
			</p>
		{/if}

		<section class="space-y-2 border-t border-border pt-4">
			<h3 class="text-sm font-medium">A new graph</h3>
			<div class="flex gap-2">
				<Input
					bind:value={opening}
					class="h-11 flex-1"
					autocomplete="off"
					maxlength={512}
					placeholder="The garden"
					aria-label="Name the new graph"
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						e.preventDefault();
						void openGraph();
					}}
				/>
				<Button
					class="h-11 shrink-0"
					disabled={working || opening.trim() === ''}
					onclick={openGraph}
				>
					<Plus class="size-4" />
					Start it
				</Button>
			</div>
		</section>

		{#if deleted.length > 0}
			<section class="space-y-2 border-t border-border pt-4">
				<h3 class="text-sm font-medium">Recently deleted</h3>
				<ul class="space-y-1">
					{#each deleted as branch (branch.ref)}
						<li class="flex items-center gap-2 px-2">
							<div class="min-w-0 flex-1">
								<p class="flex min-w-0 items-baseline gap-2 text-sm">
									{#if branch.address}
										<span class="shrink-0 address text-xs">{branch.address}</span>
									{/if}
									<span class="min-w-0 flex-1 truncate">{nameOf(branch)}</span>
								</p>
								<p class="truncate text-xs text-muted-foreground">
									{graphHolding(branch)} ·
									{branch.notes === 1 ? '1 note' : `${branch.notes.toLocaleString()} notes`} ·
									{branch.within}
								</p>
							</div>
							<Button
								variant="outline"
								class="h-9 shrink-0 rounded-full text-xs"
								disabled={working || onRestore === undefined}
								aria-label={`Put ${noteLabel(branch)} in ${graphHolding(branch)} back`}
								onclick={() => void putBack(branch)}
							>
								<Undo2 class="size-4" />
								{putting === branch.ref ? 'Putting it back' : 'Put it back'}
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if refused ?? says}
			<p class="text-sm text-destructive" role="alert">{refused ?? says}</p>
		{/if}
	</div>
</ResponsiveModal>

<ConfirmModal
	bind:open={confirming}
	title={closing ? `Close ${nameOf(closing)}?` : 'Close this graph?'}
	description={closeSays}
	confirmLabel="Close it"
	refused={closeRefused}
	onconfirm={closeGraph}
/>
