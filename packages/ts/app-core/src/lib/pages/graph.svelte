<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';

	// Outside the component: the nav pill's destinations are real navigations, so
	// the graph is torn down on the way to settings and rebuilt on the way back,
	// and which branches the reader folded is their place in it.
	const folded = new SvelteSet<OwnedRef>();

	/** How many notes may be open at once — DESIGN.md § Layout. */
	const MOST_OPEN = 6;
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
	import Files from '@lucide/svelte/icons/files';
	import FoldVertical from '@lucide/svelte/icons/fold-vertical';
	import Hash from '@lucide/svelte/icons/hash';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import type { GraphHoverAt, GraphMenuAt, MarkPictures } from '@sloppy/graph';
	import {
		NodeBulkRequestSchema,
		RootAddressSchema,
		type NodeAppearance,
		type NodeBulkAct,
		type NodeView,
		type PullView,
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
		GroundChoice,
		nameOf,
		NotePreview,
		overlay,
		PeersSheet,
		ReadingPanel,
		ResponsiveModal,
		TagRail,
		TemplatePicker,
		type CanvasMenuItem,
		type HeldRegion,
		type NoteTemplate,
		type PreviewedNote
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
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
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
	/** Where the reader was when opening another note was refused for want of
	 *  room: the strip, and the note in front of them. What that says is derived
	 *  from this rather than latched, because Back and Forward reach `openNotes`
	 *  through nothing this page runs — a message cleared by hand outlives them. */
	let refusedAt = $state<{ strip: readonly OwnedRef[]; reading: OwnedRef | null } | null>(null);
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
	/** The strip held while the surface is out of the graph's way, so a question
	 *  put to the graph does not cost the reader the notes they had open. */
	let aside = $state<readonly OwnedRef[]>([]);
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
	/** The mark a pointer has come to rest on, and where it is drawn. */
	let hoverAt = $state<GraphHoverAt | null>(null);
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
	/** Whether the graphs of other people are being looked through. */
	let visiting = $state(false);
	/**
	 * The held region on the canvas, or `null` for the reader's own graph. One
	 * author's graph is drawn at a time: an address is a place in the graph it
	 * was written in, so a peer's `1a` and the reader's own are two notes that
	 * seed identically and mean different things.
	 */
	let foreign = $state<PullView | null>(null);
	/**
	 * The held note the reader last reached for, which the canvas opens around.
	 * A held note's interior is deliberately not opened onto the reading surface:
	 * `pages/node.svelte` reads the reader's own notes and writes to them, and
	 * handing it somebody else's would show a note that is not there.
	 */
	let reached = $state<OwnedRef | null>(null);

	const markPictures: MarkPictures = { read: (upload) => api.ownPicture(upload) };

	const roots = $derived(nodes.region());
	const open = $derived(page.state.note ?? null);
	/** Every note open on the reading surface, in the order they were opened. */
	const openNotes = $derived<readonly OwnedRef[]>(page.state.notes ?? (open ? [open] : []));
	const tabs = $derived(
		openNotes.map((ref) => {
			const note = nodes.get(ref);
			return { ref, address: note?.address ?? '', title: note?.title ?? '' };
		})
	);
	/** Why another note could not be opened beside the ones already open. */
	const tooMany = $derived(
		refusedAt !== null &&
			refusedAt.reading === open &&
			refusedAt.strip.length === openNotes.length &&
			refusedAt.strip.every((held, at) => held === openNotes[at])
			? `You can have ${MOST_OPEN} notes open at once. Close one to open another.`
			: null
	);
	// Spent the moment the reader moves, so coming back to the same tabs is not
	// asking again — a history pop and a deliberate switch both count as moving.
	$effect(() => {
		if (refusedAt !== null && tooMany === null) refusedAt = null;
	});
	const openNode = $derived(open ? nodes.get(open) : undefined);
	const pointingNote = $derived(pointing ? nodes.get(pointing) : undefined);
	/** The region's notes, already in address order. */
	const heldNotes = $derived(foreign ? peers.held(foreign.ref) : []);
	const populated = $derived(
		foreign ? heldNotes.length > 0 : !loading && !unreachable && roots.length > 0
	);

	/** Depth-first from the roots, which is address order without re-deriving it. */
	const visible = $derived.by(() => {
		if (foreign) return heldNotes;
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

	/** What the canvas lifts off the paper — DESIGN.md § "The mark". */
	const reading = $derived(
		openNotes.length > 0 ? { open: new Set(openNotes), active: open } : undefined
	);

	/** What a surface over the graph acts on: the note a menu named, or every
	 *  note chosen — one note is a set of one, and takes the same acts. */
	const acted = $derived(oneNote ? [oneNote] : [...picked]);
	const actedNotes = $derived(
		acted.map((ref) => nodes.get(ref)).filter((note) => note !== undefined)
	);
	const actedTags = $derived([...new Set(actedNotes.flatMap((note) => note.tags))]);
	const overGraph = $derived(overlay.open || menuAt !== null);

	/** What the mark under the pointer stands for: the note it IS, and — since a
	 *  fold is drawn rather than stored — what the canvas folded into it. */
	const previewed = $derived.by((): PreviewedNote | undefined => {
		if (!hoverAt) return undefined;
		const note = foreign
			? heldNotes.find((held) => held.ref === hoverAt?.ref)
			: nodes.get(hoverAt.ref);
		if (!note) return undefined;
		return {
			address: note.address,
			title: note.title,
			tags: hoverAt.tags,
			picture: note.appearance?.preview !== undefined,
			folded: hoverAt.folded
		};
	});

	// Whatever opened over the graph is what the reader is looking at now.
	$effect(() => {
		if (overGraph) hoverAt = null;
	});

	/** Notes carrying ANY of the selected tags, which is what the canvas lights. */
	const lit = $derived(
		selection.length === 0
			? 0
			: visible.filter((note) => note.tags.some((tag) => selection.includes(tag))).length
	);

	const summary = $derived(
		selection.length > 0
			? `${lit.toLocaleString()} of ${count(visible.length, 'note', 'notes')} lit up`
			: foreign
				? count(visible.length, 'note', 'notes')
				: `${count(visible.length, 'note', 'notes')} across ${count(roots.length, 'branch', 'branches')}`
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
		if (cited && !page.state.note) replaceState('', { note: cited, notes: [cited] });
	}

	onMount(() => {
		openCited();
		void loadGraph();
		void peers.load();
	});

	afterNavigate(openCited);

	// Re-runs as the cache fills, so a note reached by its address is never left
	// inside a branch the reader folded earlier.
	$effect(() => {
		for (const of of openNotes) {
			let node = nodes.get(of);
			while (node?.parent) {
				folded.delete(node.parent);
				node = nodes.get(node.parent);
			}
		}
	});

	/** The strip once `ref` has taken `standing`'s place — or unchanged where it is
	 *  already open, which is a switch rather than an open. `standing` defaults to
	 *  the tab being read; a note written from another one takes THAT tab, which is
	 *  not always the one in front of the reader when the server answers. Where
	 *  that tab has been closed in the meantime the note joins the strip, unless
	 *  the strip is full — then it takes the tab being read, because there is
	 *  nowhere else to put it. */
	function inPlaceOf(ref: OwnedRef, standing: OwnedRef | null = null): readonly OwnedRef[] {
		const strip = openNotes.length > 0 ? openNotes : aside;
		if (strip.includes(ref)) return strip;
		const gone = standing !== null && !strip.includes(standing);
		if (gone && strip.length > 0 && strip.length < MOST_OPEN) return [...strip, ref];
		const held = gone ? open : (standing ?? open);
		if (held === null) return [ref];
		return strip.map((one) => (one === held ? ref : one));
	}

	/** Shallow, so the graph behind the notes is never torn down and rebuilt. */
	function goTo(ref: OwnedRef, strip: readonly OwnedRef[]): void {
		aside = [];
		pushState(nodeHref(ref), { note: ref, notes: [...strip] });
	}

	/** `wrote` marks a note just written, whose title is still to be given: `from`
	 *  is the note it was written from, or nothing where it began a branch. */
	function show(
		ref: OwnedRef,
		wrote: { from: OwnedRef | null; shape: NoteTemplate | null } | null = null
	): void {
		naming = wrote ? ref : null;
		seed = wrote?.shape ? { ref, shape: wrote.shape } : null;
		refused = null;
		goTo(ref, inPlaceOf(ref, wrote?.from ?? null));
	}

	/** Opened beside what is already here rather than in its place. */
	function showAlso(ref: OwnedRef): void {
		if (openNotes.includes(ref)) {
			show(ref);
			return;
		}
		if (openNotes.length >= MOST_OPEN) {
			refusedAt = { strip: [...openNotes], reading: open };
			return;
		}
		naming = null;
		seed = null;
		goTo(ref, [...openNotes, ref]);
	}

	function activate(ref: OwnedRef): void {
		if (ref === open) return;
		naming = null;
		seed = null;
		goTo(ref, openNotes);
	}

	/** Closing the one being read leaves the reader on the note before it, or on
	 *  the one after it where it was first. Tidying up is not somewhere the
	 *  reader went, so it replaces the history entry rather than adding one. */
	function closeTab(ref: OwnedRef): void {
		const left = openNotes.filter((held) => held !== ref);
		const next = ref === open ? left[Math.max(0, openNotes.indexOf(ref) - 1)] : open;
		if (next === undefined || next === null) {
			hide();
			return;
		}
		naming = null;
		seed = null;
		replaceState(nodeHref(next), { note: next, notes: left });
	}

	/** Notes that are no longer there leave the strip with them — the ones deleted,
	 *  and the branch under each, which the graph drops with its root. `instead` is
	 *  the note that stands in the tab the reader was in, where there is one. */
	function closeGone(deleted: readonly OwnedRef[], instead: OwnedRef | null = null): void {
		const going = new Set(deleted);
		const gone = (held: OwnedRef) => going.has(held) || nodes.get(held) === undefined;
		if (!openNotes.some(gone)) return;
		const stand =
			instead !== null && !gone(instead) && !openNotes.includes(instead) ? instead : null;
		const left = openNotes.flatMap((held) =>
			!gone(held) ? [held] : stand !== null && held === open ? [stand] : []
		);
		const next = open !== null && !gone(open) ? open : (stand ?? left[0]);
		if (next === undefined || next === null) {
			hide();
			return;
		}
		naming = null;
		seed = null;
		replaceState(nodeHref(next), { note: next, notes: left });
	}

	/** The surface put away, and every note on it closed with it. */
	function hide(): void {
		putAway([]);
	}

	/** The surface out of the graph's way with the notes on it still open, so
	 *  they come back when the graph has answered. */
	function stepAside(): void {
		putAway(openNotes);
	}

	function putAway(held: readonly OwnedRef[]): void {
		naming = null;
		seed = null;
		aside = held;
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
		stepAside();
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
		closeGone(asked);
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
			{ label: 'Open it', icon: FileText, onSelect: () => show(on) }
		];
		// A phone has no modifier to hold, so this is the way in on both surfaces
		// — a press and hold, and a right-click.
		if (openNotes.length > 0 && !openNotes.includes(on)) {
			items.push({ label: 'Open it as well', icon: Files, onSelect: () => showAlso(on) });
		}
		items.push(
			{ label: 'Tags', icon: Tag, onSelect: () => openTags(on) },
			{ label: 'Give it a look', icon: CircleDashed, onSelect: () => openLook(on) }
		);
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
			show((await nodes.create({})).ref, { from: null, shape });
		} catch (error) {
			refused = serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			creating = false;
		}
	}

	/**
	 * Somebody else's region, on the canvas in place of the reader's own graph.
	 * The notes they had open belong to their graph, so they close with it.
	 */
	async function enterRegion(ref: OwnedRef): Promise<void> {
		const region = peers.region(ref);
		if (!region) return;
		stopChoosing();
		stopPointing();
		hide();
		reached = null;
		foreign = region;
		await peers.enter(ref);
	}

	function leaveRegion(): void {
		foreign = null;
		reached = null;
	}

	const heldRegions = $derived<HeldRegion[]>(
		peers.regions.map((region) => ({
			ref: region.ref,
			identity: region.source_did,
			person: people.of(region.source_did),
			address: region.root_address,
			from: region.source_url
		}))
	);

	const followedPeople = $derived(
		peers.following.map((one) => ({ identity: one.did, person: people.of(one.did) }))
	);

	/** Whoever a peer surface is about to name, asked for once. */
	$effect(() => {
		for (const one of peers.following) people.resolve(one.did);
		for (const region of peers.regions) people.resolve(region.source_did);
	});

	const regionAuthor = $derived(foreign ? people.of(foreign.source_did) : null);

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
			show(written.ref, { from: null, shape: null });
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
				remountKey={foreign?.ref}
				focus={foreign ? (reached ?? undefined) : (open ?? looking ?? undefined)}
				picking={pointing && pointingNote
					? {
							from: pointing,
							taken: new Set(pointingNote.links),
							onPick: (ref) => void pointAt(ref)
						}
					: undefined}
				pictures={markPictures}
				reading={foreign ? undefined : reading}
				ground={prefs.current.ground}
				onHover={(at) => (hoverAt = overGraph ? null : at)}
				chosen={foreign ? undefined : chosen}
				onChoose={pointing || foreign ? undefined : chooseAlso}
				onChooseWithin={pointing || foreign ? undefined : chooseWithin}
				onMenu={pointing || foreign ? undefined : (at) => (menuAt = at)}
				onOpenNode={foreign ? (ref) => (reached = ref) : show}
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
				{#if loading || (foreign && peers.busy)}
					<div class="space-y-2 px-2 pt-2">
						{#each Array.from({ length: 6 }, (_, row) => row) as row (row)}
							<Skeleton class="h-11 w-full" />
						{/each}
					</div>
				{:else if foreign}
					<div class="mx-auto max-w-sm space-y-5 py-20 text-center">
						<p class="text-muted-foreground" role="alert">
							{peers.says ?? 'There is nothing in this branch to read.'}
						</p>
						<Button variant="outline" class="h-11" onclick={leaveRegion}>Your graph</Button>
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
							<Button variant="ghost" class="h-11" onclick={() => (visiting = true)}>
								Read somebody else's
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
				{:else if foreign}
					<!-- Whose thought this is, said in words at the region it is about —
					     DESIGN.md § Form, PRODUCT.md principle 4. -->
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p class="w-full min-w-0 truncate text-sm sm:w-auto sm:flex-1">
							<span class="address">{foreign.root_address}</span>
							<span>{regionAuthor ? nameOf(regionAuthor) : foreign.source_did}</span>
							<span class="text-muted-foreground">· {summary}</span>
						</p>
						<Button
							variant="outline"
							class="ms-auto h-9 shrink-0 rounded-full"
							onclick={leaveRegion}
						>
							Your graph
						</Button>
						<GroundChoice
							value={prefs.current.ground}
							onchange={(ground) => prefs.set('ground', ground)}
						/>
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p class="w-full min-w-0 truncate text-sm text-muted-foreground sm:w-auto sm:flex-1">
							{summary}
						</p>
						<Button
							variant="outline"
							class="ms-auto h-9 shrink-0 rounded-full"
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
						<Button
							variant="ghost"
							size="icon"
							class="size-9 shrink-0 rounded-full"
							aria-label="Other people's graphs"
							onclick={() => (visiting = true)}
						>
							<Users class="size-4" />
						</Button>
						<GroundChoice
							value={prefs.current.ground}
							onchange={(ground) => prefs.set('ground', ground)}
						/>
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

<NotePreview at={hoverAt} note={previewed} selected={selection} />

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

<PeersSheet
	bind:open={visiting}
	regions={heldRegions}
	following={followedPeople}
	busy={peers.busy}
	says={peers.says}
	onEnter={(ref) => void enterRegion(ref)}
	onDrop={(ref) => {
		if (foreign?.ref === ref) leaveRegion();
		void peers.drop(ref);
	}}
	onLook={async (identity, where, cursor) => {
		const page = await peers.publishedBy(identity, { sourceUrl: where, cursor });
		return page && { roots: page.roots, nextCursor: page.next_cursor };
	}}
	onPull={async (identity, where, address) => {
		const region = await peers.pull({ did: identity, rootAddress: address, sourceUrl: where });
		if (!region) return;
		visiting = false;
		await enterRegion(region.ref);
	}}
	onFollow={(identity) => void peers.follow(identity)}
	onUnfollow={(identity) => void peers.unfollow(identity)}
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
	{tabs}
	active={open}
	says={tooMany}
	width={prefs.current.readingWidth}
	onWidthChange={(px) => prefs.set('readingWidth', px)}
	onActivate={activate}
	onCloseTab={closeTab}
>
	{#if open}
		<Note
			ref={open}
			{naming}
			{seed}
			{openNotes}
			onSeeded={() => (seed = null)}
			onOpen={show}
			onOpenAlso={showAlso}
			onLinkOnGraph={() => pointFrom(open)}
			onDeleted={(of, above) => closeGone([of], above)}
			onClose={hide}
		/>
	{/if}
</ReadingPanel>
