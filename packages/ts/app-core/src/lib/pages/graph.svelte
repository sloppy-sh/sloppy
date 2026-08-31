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
	// opens beside it. DESIGN.md § Layout — the graph is the page.
	import Check from '@lucide/svelte/icons/check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import FileText from '@lucide/svelte/icons/file-text';
	import FoldVertical from '@lucide/svelte/icons/fold-vertical';
	import Hash from '@lucide/svelte/icons/hash';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { GraphMenuAt, MarkPictures } from '@sloppy/graph';
	import {
		NodeBulkRequestSchema,
		RootAddressSchema,
		type NodeAppearance,
		type NodeBulkAct,
		type NodeView,
		type Tag as TagName
	} from '@sloppy/types';
	import {
		AppearanceModal,
		CanvasMenu,
		ChosenBar,
		ChosenLook,
		ChosenTags,
		ConfirmModal,
		GraphSurface,
		overlay,
		ReadingPanel,
		ResponsiveModal,
		TagRail,
		TemplatePicker,
		type CanvasMenuItem,
		type NoteTemplate
	} from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount } from 'svelte';
	import { afterNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { deletionCost } from '../deletion.js';
	import { noteMedia } from '../note-surface.js';
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
	/** Whether the shapes a branch can start from are being offered. */
	let shaping = $state(false);
	/** What the rail covers, so the graph frames itself into what is left. */
	let railHeight = $state(0);
	/** The note just written, whose title is still waiting to be given. */
	let naming = $state<OwnedRef | null>(null);
	/** The shape that note was written to start from, which it seeds itself with. */
	let seed = $state<{ ref: OwnedRef; shape: NoteTemplate } | null>(null);
	/** The note a link is being pointed FROM, while the graph is the picker. */
	let pointing = $state<OwnedRef | null>(null);
	/** Where the reader has got to while looking for the note they mean: the one
	 *  they are pointing from, and then whichever mega-node they opened. */
	let looking = $state<OwnedRef | null>(null);
	let pointRefused = $state<string | null>(null);
	let linking = $state(false);
	/** Whether notes are being chosen to act on; the set may still be empty. */
	let choosing = $state(false);
	const picked = new SvelteSet<OwnedRef>();
	/** The one note the menu's acts are about; null where they are the set's.
	 *  Set by whatever opens a surface, so an act always knows whose it is. */
	let oneNote = $state<OwnedRef | null>(null);
	/** Where the canvas was asked for a menu, and on what. */
	let menuAt = $state<GraphMenuAt | null>(null);
	let tagging = $state(false);
	let styling = $state(false);
	let deleting = $state(false);
	/** How many notes the delete question was asked about, and what it costs.
	 *  Latched: the set is let go the moment the act lands, while the question is
	 *  still closing. */
	let deletingCount = $state(0);
	let deletionSays = $state('');
	/** Why the last act on the chosen notes did not land. */
	let actRefused = $state<string | null>(null);
	/** How much of the last act's set was already gone, where the rest landed. */
	let actMissed = $state<string | null>(null);
	/** The act in flight, which the next one asked for queues behind. */
	let acting: Promise<void> = Promise.resolve();

	const markPictures: MarkPictures = { read: (upload) => api.ownPicture(upload) };

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
	const collapsed = $derived(new Set(folded));

	const selection = $derived(tags.selected);

	/**
	 * The notes chosen to act on — DESIGN.md § "The mark" keeps that word for
	 * them, because `selection` above is already the reader's tags. Copied, so a
	 * change reaches the canvas as a new set.
	 */
	const chosen = $derived(choosing ? new Set(picked) : undefined);

	/** What a surface over the graph acts on: the note a menu named, or every
	 *  note chosen — one note is a set of one, and takes the same acts. */
	const acted = $derived(oneNote ? [oneNote] : [...picked]);
	const actedNotes = $derived(
		acted.map((ref) => nodes.get(ref)).filter((note) => note !== undefined)
	);
	const actedTags = $derived([...new Set(actedNotes.flatMap((note) => note.tags))]);
	const overGraph = $derived(overlay.open || menuAt !== null);

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

	function show(ref: OwnedRef, fresh = false, shape: NoteTemplate | null = null): void {
		naming = fresh ? ref : null;
		seed = shape ? { ref, shape } : null;
		pushState(nodeHref(ref), { note: ref });
	}

	/** Shallow, so the graph behind the note is never torn down and rebuilt. */
	function hide(): void {
		naming = null;
		seed = null;
		replaceState('/', {});
	}

	/** The note steps aside so the graph it belongs to can answer the question. */
	function pointFrom(from: OwnedRef): void {
		pointRefused = null;
		// One mode at a time: a canvas asked to point at a note stops being one
		// anybody is choosing on. DESIGN.md § "The mark".
		stopChoosing();
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

	/** Through the schema the API refuses by, so both say the same thing. */
	function noRoomFor(refs: readonly OwnedRef[]): string | null {
		const room = NodeBulkRequestSchema.shape.notes.safeParse(refs);
		return room.success ? null : room.error.issues[0].message;
	}

	function forgetLastAct(): void {
		actRefused = null;
		actMissed = null;
	}

	function startChoosing(): void {
		choosing = true;
		forgetLastAct();
	}

	function stopChoosing(): void {
		choosing = false;
		picked.clear();
		forgetLastAct();
	}

	/** The way in as well as the way around: the first note chosen is what puts
	 *  the canvas in the mode, whether it came from a menu or a modifier-click. */
	function chooseAlso(ref: OwnedRef): void {
		choosing = true;
		forgetLastAct();
		if (picked.has(ref)) {
			picked.delete(ref);
			return;
		}
		const full = noRoomFor([...picked, ref]);
		if (full) actRefused = full;
		else picked.add(ref);
	}

	function chooseWithin(refs: readonly OwnedRef[]): void {
		choosing = true;
		forgetLastAct();
		for (const ref of refs) {
			if (picked.has(ref)) continue;
			const full = noRoomFor([...picked, ref]);
			if (full) {
				actRefused = full;
				return;
			}
			picked.add(ref);
		}
	}

	/**
	 * One act over every note it is about. Throws so the surface that asked keeps
	 * its question open and its own button ready to try again.
	 *
	 * A second act asked for while one is in flight queues rather than being
	 * dropped: the tag sheet is where several words are typed in a row, and a
	 * caller cannot tell a dropped act from a done one.
	 */
	async function actOnThem(act: NodeBulkAct): Promise<void> {
		const asked = [...acted];
		if (asked.length === 0) return;
		const mine = acting.then(() => runAct(asked, act));
		acting = mine.catch(() => {});
		await mine;
	}

	async function runAct(asked: OwnedRef[], act: NodeBulkAct): Promise<void> {
		forgetLastAct();
		let missed: number;
		try {
			missed = (await nodes.act({ notes: asked, act })).missed;
		} catch (error) {
			actRefused =
				serverMessage(error) ?? 'Sloppy could not change those notes. Try again in a moment.';
			throw error;
		}
		const shortfall = missed === 0 ? null : alreadyGone(missed, asked.length);
		// A tag exists as long as a note carries one, so the rail's counts are stale
		// the moment notes are tagged — or taken away with the tags they carried.
		if (act.act !== 'set_appearance') void tags.reload();
		if (act.act !== 'delete') {
			actMissed = shortfall;
			return;
		}
		if (open && asked.includes(open)) hide();
		// The bar goes with the set, so what is left to say goes beside the graph.
		oneNote = null;
		stopChoosing();
		refused = shortfall;
	}

	function alreadyGone(missed: number, asked: number): string {
		if (asked === 1) return 'That note was already gone.';
		return missed === 1
			? 'One of the notes you chose was already gone.'
			: `${missed.toLocaleString()} of the notes you chose were already gone.`;
	}

	const menuItems = $derived.by((): CanvasMenuItem[] => {
		const at = menuAt;
		if (!at) return [];
		const on = at.ref;
		if (!choosing) {
			if (!on) return [{ label: 'Choose notes', icon: ListChecks, onSelect: startChoosing }];
			return actsOnOne(on, at.foldable);
		}

		const items: CanvasMenuItem[] = [];
		if (on) {
			const held = picked.has(on);
			items.push({
				label: held ? 'Leave this one out' : 'Choose this one too',
				icon: held ? Minus : Plus,
				onSelect: () => chooseAlso(on)
			});
		}
		if (picked.size > 0) {
			items.push(
				{ label: 'Tags', icon: Tag, onSelect: () => openTags(null) },
				{ label: 'Give them a look', icon: CircleDashed, onSelect: () => openLook(null) },
				{
					label: picked.size === 1 ? 'Delete it' : `Delete these ${picked.size}`,
					icon: Trash2,
					destructive: true,
					onSelect: () => askToDelete(null)
				}
			);
		}
		items.push({ label: 'Done choosing', icon: Check, onSelect: stopChoosing });
		return items;
	});

	/** Kept short: the menu has a phone to fit on, beside the note it is about. */
	function actsOnOne(on: OwnedRef, foldable: boolean): CanvasMenuItem[] {
		const items: CanvasMenuItem[] = [
			{ label: 'Open it', icon: FileText, onSelect: () => show(on) },
			{ label: 'Tags', icon: Tag, onSelect: () => openTags(on) },
			{ label: 'Give it a look', icon: CircleDashed, onSelect: () => openLook(on) }
		];
		if (foldable) {
			items.push({
				label: 'Fold what is under this',
				icon: FoldVertical,
				onSelect: () => folded.add(on)
			});
		}
		items.push(
			{ label: 'Choose this and others', icon: ListChecks, onSelect: () => chooseAlso(on) },
			{
				label: 'Delete it',
				icon: Trash2,
				destructive: true,
				onSelect: () => askToDelete(on)
			}
		);
		return items;
	}

	function openTags(one: OwnedRef | null): void {
		oneNote = one;
		forgetLastAct();
		tagging = true;
	}

	function openLook(one: OwnedRef | null): void {
		oneNote = one;
		forgetLastAct();
		styling = true;
	}

	function askToDelete(one: OwnedRef | null): void {
		oneNote = one;
		forgetLastAct();
		deletingCount = acted.length;
		deletionSays = deletionCost(acted);
		deleting = true;
	}

	/** A branch of its own. A note that continues one is written from inside it. */
	async function writeBranch(shape: NoteTemplate | null): Promise<void> {
		if (creating) return;
		creating = true;
		refused = null;
		try {
			show((await nodes.create({})).ref, true, shape);
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
	onkeydowncapture={(event) => {
		if (event.key !== 'Escape') return;
		if (pointing) stopPointing();
		// Capture, so this reads whether a surface is over the graph BEFORE that
		// surface closes itself on the same keystroke — otherwise one Escape both
		// puts the question away and ends what it was asked about.
		else if (choosing && !overGraph) stopChoosing();
	}}
/>

<div class="viewport-fit relative mr-[var(--reading-dock-inset-right,0px)]">
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
				pictures={markPictures}
				{chosen}
				onChoose={pointing ? undefined : chooseAlso}
				onChooseWithin={pointing ? undefined : chooseWithin}
				onMenu={pointing ? undefined : (at) => (menuAt = at)}
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
							<Button class="h-11" disabled={creating} onclick={() => writeBranch(null)}>
								Write the first note
							</Button>
							<Button
								variant="ghost"
								class="h-11"
								disabled={creating}
								onclick={() => (shaping = true)}
							>
								Start from a shape
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
							onclick={() => writeBranch(null)}
						>
							<Plus class="size-4" />
							New branch
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 shrink-0 rounded-full"
							aria-label="A new branch, from a shape"
							disabled={creating}
							onclick={() => (shaping = true)}
						>
							<LayoutTemplate class="size-4" />
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

	{#if populated && choosing}
		<ChosenBar
			count={picked.size}
			says={actRefused ?? actMissed}
			onTags={() => openTags(null)}
			onLook={() => openLook(null)}
			onDelete={() => askToDelete(null)}
			onDone={stopChoosing}
		/>
	{/if}
</div>

<CanvasMenu
	at={menuAt}
	items={menuItems}
	label="What you can do here"
	onclose={() => (menuAt = null)}
/>

<ChosenTags
	bind:open={tagging}
	count={acted.length}
	tags={actedTags}
	suggestions={tags.all}
	refused={actRefused}
	missed={actMissed}
	onadd={(added: TagName[]) => actOnThem({ act: 'tag', tags: added })}
	onremove={(gone: TagName[]) => actOnThem({ act: 'untag', tags: gone })}
/>

<!-- One note gets the surface its own page gives it, which is the one a picture
     can be put on; several get the shapes they can be given all at once. -->
{#if oneNote}
	<AppearanceModal
		bind:open={styling}
		appearance={actedNotes[0]?.appearance ?? null}
		media={noteMedia}
		refused={actRefused}
		onchange={(look: NodeAppearance | null) =>
			actOnThem({ act: 'set_appearance', appearance: look })}
	/>
{:else}
	<ChosenLook
		bind:open={styling}
		count={acted.length}
		refused={actRefused}
		onapply={(look: NodeAppearance | null) =>
			actOnThem({ act: 'set_appearance', appearance: look })}
	/>
{/if}

<ConfirmModal
	bind:open={deleting}
	title={deletingCount === 1 ? 'Delete this note?' : `Delete these ${deletingCount} notes?`}
	description={deletionSays}
	confirmLabel={deletingCount === 1 ? 'Delete it' : `Delete ${deletingCount} notes`}
	refused={actRefused}
	onconfirm={() => actOnThem({ act: 'delete' })}
/>

<TemplatePicker
	bind:open={shaping}
	onpick={(shape) => {
		shaping = false;
		void writeBranch(shape);
	}}
/>

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

<ReadingPanel
	open={open !== null}
	onOpenChange={(v) => {
		if (!v) hide();
	}}
	title={openNode?.title || 'Note'}
>
	{#if open}
		<Note
			ref={open}
			{naming}
			{seed}
			onSeeded={() => (seed = null)}
			onOpen={show}
			onLinkOnGraph={() => pointFrom(open)}
			onClose={hide}
		/>
	{/if}
</ReadingPanel>
