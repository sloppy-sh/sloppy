<script lang="ts" module>
	import { noteLabel, type GraphOwnership, type OwnedRef } from '@sloppy/types';

	/** One of somebody's graphs, as this sheet lists it. */
	export interface GraphChoice {
		/** Absent where this device cannot read the graph in the folder it is
		 *  kept in: the folder has been moved or emptied, and the row says so
		 *  rather than offering anything but forgetting it. */
		ref?: OwnedRef;
		title: string;
		/** What it does to a note written in it from here on. Absent is `open`. */
		ownership?: GraphOwnership;
		/** The folder it is kept in, where this device's graphs are folders.
		 *  Absent everywhere else, and a row carrying one is chosen by opening
		 *  that folder rather than by moving into the graph. */
		folder?: string;
		/** What the person calls that folder, shown under the graph's name where
		 *  a second folder holds the same graph and the name alone tells nobody
		 *  which row is which. */
		folderName?: string;
		/** The project whose notes it is, as a person calls the project's own
		 *  folder. Absent where the graph is nobody's project. */
		project?: string;
		/** Whose graph it is, where that is somebody other than the reader. */
		by?: string;
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
	import FolderCode from '@lucide/svelte/icons/folder-code';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		graphs,
		current,
		home,
		openFolder,
		alsoUp,
		full = false,
		busy = false,
		says = null,
		deleted = [],
		publishedFrom = undefined,
		onEnter,
		onToggle,
		onOpen,
		onOpenFolder,
		onStart,
		onOpenProject,
		onClone,
		onForget,
		onRename,
		onOwnership,
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
		/** The folder that is open, by its root, where the rows are folders: the
		 *  row at it is the one in front of the reader, and two folders holding
		 *  one graph are still two rows. Absent → the row carrying
		 *  {@link current}. */
		openFolder?: string;
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
		/** Read the graph kept in that folder from now on. Absent leaves every
		 *  row a graph to move into rather than a folder to open. */
		onOpenFolder?: (folder: string) => Promise<void>;
		/** Ask somebody for a folder to keep a graph in. Absent leaves a graph
		 *  something started by naming it here. */
		onStart?: () => Promise<void>;
		/** Ask somebody for a project's own folder and read the notes kept in it.
		 *  Absent where this device cannot reach a project's folder, and nothing
		 *  about opening one is offered. */
		onOpenProject?: () => Promise<void>;
		/** Bring a copy of a graph kept somewhere else onto this device. Absent
		 *  where this device has no way to. */
		onClone?: (url: string) => Promise<void>;
		/** Take a folder off this device's list, leaving everything in it. */
		onForget?: (folder: string) => Promise<void>;
		onRename: (ref: OwnedRef, title: string) => Promise<void>;
		/** What a note written in this graph from here on carries. Absent leaves
		 *  the choice off the sheet. */
		onOwnership?: (ref: OwnedRef, ownership: GraphOwnership) => Promise<void>;
		onRemove?: (ref: OwnedRef) => Promise<void>;
		onRestore?: (ref: OwnedRef) => Promise<void>;
		/** The sheet has just opened, and what it lists is worth asking for again. */
		onShow?: () => void;
	} = $props();

	let opening = $state('');
	let bringing = $state('');
	let naming = $state<{ ref: OwnedRef; title: string; owned: boolean } | null>(null);
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
		[
			'The notes in it go with it, and they cannot be put back.',
			...(closing?.ref !== undefined && publishedFrom && !publishedFrom.has(closing.ref)
				? []
				: ['Whoever already has a branch you published from it keeps their copy.'])
		].join(' ')
	);

	function nameOf(graph: GraphChoice | DeletedChoice): string {
		return graph.title || 'Untitled';
	}

	/** The row the reader is in. Where the rows are folders it is the folder
	 *  that is open: two of them can hold one graph, and the ref cannot tell
	 *  those apart. */
	function openHere(graph: GraphChoice): boolean {
		if (openFolder !== undefined && graph.folder !== undefined) return graph.folder === openFolder;
		return graph.ref !== undefined && graph.ref === current;
	}

	/** What forgetting this row is called, folder and all: two rows may hold one
	 *  graph, and the graph's name alone would name them both. */
	function forgetting(graph: GraphChoice): string {
		const folder = graph.folderName;
		const name = nameOf(graph);
		return folder === undefined || folder === name
			? `Forget ${name}`
			: `Forget ${name} in ${folder}`;
	}

	/** Whether another row holds the same graph, which is what makes the name on
	 *  its own no longer say which folder a row means. */
	function alsoElsewhere(graph: GraphChoice): boolean {
		return graphs.filter((one) => one.ref !== undefined && one.ref === graph.ref).length > 1;
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

	async function serveFolder(folder: string): Promise<void> {
		if (!onOpenFolder) return;
		if (await act(() => onOpenFolder(folder))) open = false;
	}

	async function startFolder(): Promise<void> {
		if (!onStart) return;
		if (await act(() => onStart())) open = false;
	}

	async function openProject(): Promise<void> {
		if (!onOpenProject) return;
		if (await act(() => onOpenProject())) open = false;
	}

	async function bringOne(): Promise<void> {
		const url = bringing.trim();
		if (url === '' || !onClone) return;
		if (await act(() => onClone(url))) {
			bringing = '';
			open = false;
		}
	}

	async function closeGraph(): Promise<void> {
		const graph = closing;
		if (graph?.ref === undefined || !onRemove) return;
		const ref = graph.ref;
		closeRefused = null;
		try {
			await onRemove(ref);
		} catch (error) {
			closeRefused = error instanceof Error && error.message ? error.message : 'That did not work.';
			throw error;
		}
		closing = null;
	}

	/** The switch shows what the graph carries, so a choice that did not save goes
	 *  back where it was rather than standing as if it had. */
	async function chooseOwnership(ref: OwnedRef, owned: boolean): Promise<void> {
		if (!onOwnership) return;
		if (await act(() => onOwnership(ref, owned ? 'owned' : 'open'))) return;
		if (naming?.ref === ref) naming.owned = !owned;
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
			{#each graphs as graph (graph.folder ?? graph.ref)}
				{@const ref = graph.ref}
				{@const here = openHere(graph)}
				{@const twice = alsoElsewhere(graph)}
				{@const up = here || (ref !== undefined && alsoUp.has(ref))}
				<li class="flex flex-wrap items-center gap-2">
					{#if ref === undefined}
						<div class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-sm">
							<span class="w-4 shrink-0"></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate">{nameOf(graph)}</span>
								<span class="block truncate text-xs text-muted-foreground"> not where it was </span>
							</span>
						</div>
					{:else if naming?.ref === ref}
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
						{#if onOwnership}
							<div class="flex w-full items-start gap-3 px-1 pt-1 pb-2">
								<Switch
									id="owned-{ref}"
									bind:checked={naming.owned}
									disabled={working}
									onCheckedChange={(owned) => void chooseOwnership(ref, owned)}
								/>
								<div class="min-w-0 flex-1 space-y-1">
									<Label for="owned-{ref}" class="text-sm font-normal">
										New notes are only their writer's
									</Label>
									<p class="text-xs text-muted-foreground">
										Anyone else's change is offered to them. What is already written stays as it is.
									</p>
								</div>
							</div>
						{/if}
					{:else}
						{@const folder = graph.folder}
						<button
							type="button"
							aria-current={here ? 'true' : undefined}
							class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
							disabled={working}
							onclick={() => {
								if (folder !== undefined && onOpenFolder) {
									void serveFolder(folder);
									return;
								}
								open = false;
								onEnter(ref);
							}}
						>
							<span class="w-4 shrink-0 text-muted-foreground">
								{#if here}<Check class="size-4" aria-hidden="true" />{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate">{nameOf(graph)}</span>
								{#if graph.project && graph.project !== nameOf(graph)}
									<span class="block truncate text-xs text-muted-foreground">
										{graph.project}
									</span>
								{:else if twice && graph.folderName}
									<span class="block truncate text-xs text-muted-foreground">
										{graph.folderName}
									</span>
								{/if}
								{#if graph.by}
									<span class="block truncate text-xs text-muted-foreground">{graph.by}</span>
								{/if}
							</span>
						</button>
						{#if !twice}
							<Button
								variant={up ? 'secondary' : 'ghost'}
								class="h-9 shrink-0 rounded-full text-xs"
								disabled={here || busy || (full && !up)}
								aria-label={up
									? `Take ${nameOf(graph)} off the canvas`
									: `Show ${nameOf(graph)} beside this one`}
								onclick={() => onToggle(ref)}
							>
								{up ? 'On the canvas' : 'Show it too'}
							</Button>
						{/if}
						{#if here || !twice}
							<Button
								variant="ghost"
								size="icon"
								class="size-9 shrink-0 text-muted-foreground"
								aria-label={onOwnership
									? `Settings for ${nameOf(graph)}`
									: `Rename ${nameOf(graph)}`}
								onclick={() => {
									refused = null;
									naming = { ref, title: graph.title, owned: graph.ownership === 'owned' };
								}}
							>
								<Pencil class="size-4" />
							</Button>
						{/if}
						{#if onRemove && (folder !== undefined ? here : ref !== home && graph.by === undefined)}
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
					{#if onForget && graph.folder !== undefined && !here && (naming === null || naming.ref !== ref)}
						{@const folder = graph.folder}
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full text-xs text-muted-foreground"
							disabled={working}
							aria-label={forgetting(graph)}
							onclick={() => void act(() => onForget(folder))}
						>
							Forget
						</Button>
					{/if}
				</li>
			{/each}
		</ul>

		{#if onForget}
			<p class="px-2 text-xs text-muted-foreground">
				Forgetting a folder takes it off this list and leaves everything in it where it is. Choose
				the folder again to open it again.
			</p>
		{/if}

		{#if full}
			<p class="px-2 text-xs text-muted-foreground">
				That is as many as one canvas holds. Take one down to show another.
			</p>
		{/if}

		{#if onStart}
			<section class="space-y-2 border-t border-border pt-4">
				<h3 class="text-sm font-medium">Start a folder</h3>
				<p class="text-xs text-muted-foreground">
					An empty folder becomes a graph of its own. One that already holds a graph opens it.
				</p>
				<Button class="h-11 w-full" disabled={working} onclick={startFolder}>
					<Plus class="size-4" />
					Choose a folder
				</Button>
			</section>
			{#if onOpenProject}
				<section class="space-y-2 border-t border-border pt-4">
					<h3 class="text-sm font-medium">Open a project</h3>
					<p class="text-xs text-muted-foreground">
						Notes that sit with the code they are about. Choose the project's own folder.
					</p>
					<Button variant="outline" class="h-11 w-full" disabled={working} onclick={openProject}>
						<FolderCode class="size-4" />
						Choose a project
					</Button>
				</section>
			{/if}
			{#if onClone}
				<section class="space-y-2 border-t border-border pt-4">
					<h3 class="text-sm font-medium">Bring one from an address</h3>
					<p class="text-xs text-muted-foreground">
						A copy of a graph kept somewhere else, brought onto this device.
					</p>
					<div class="flex gap-2">
						<Input
							bind:value={bringing}
							class="h-11 flex-1"
							autocomplete="off"
							autocapitalize="none"
							spellcheck={false}
							maxlength={2048}
							placeholder="https://…"
							aria-label="Where the graph is kept"
							onkeydown={(e) => {
								if (e.key !== 'Enter') return;
								e.preventDefault();
								void bringOne();
							}}
						/>
						<Button
							class="h-11 shrink-0"
							disabled={working || bringing.trim() === ''}
							onclick={bringOne}
						>
							Bring it here
						</Button>
					</div>
				</section>
			{/if}
		{:else}
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
		{/if}

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
