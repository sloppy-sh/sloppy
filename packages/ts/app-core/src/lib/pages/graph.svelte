<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';

	// Outside the component: the nav pill's destinations are real navigations, so
	// the graph is torn down on the way to settings and rebuilt on the way back,
	// and which branches the reader folded is their place in it.
	const folded = new SvelteSet<OwnedRef>();

	// Kept for the same reason, and separately from `folded`: the canvas draws
	// every note and folds what the reader folds, while the tree draws none and
	// opens what they open, so one place cannot answer for the other.
	const unfolded = new SvelteSet<OwnedRef>();

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
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Download from '@lucide/svelte/icons/download';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import FileText from '@lucide/svelte/icons/file-text';
	import Files from '@lucide/svelte/icons/files';
	import FoldVertical from '@lucide/svelte/icons/fold-vertical';
	import Globe from '@lucide/svelte/icons/globe';
	import Hash from '@lucide/svelte/icons/hash';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minus from '@lucide/svelte/icons/minus';
	import Network from '@lucide/svelte/icons/network';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import Users from '@lucide/svelte/icons/users';
	import {
		comparingStates,
		DEFAULT_BUDGET,
		type GraphDifference,
		type GraphHandle,
		type GraphHoverAt,
		type GraphMenuAt,
		type GraphPictures,
		type GraphTransform
	} from '@sloppy/graph';
	import {
		MAX_NOTES_PER_BULK_ACT,
		NodeBulkRequestSchema,
		pictureTurn,
		RootAddressSchema,
		graphOf,
		noteLabel,
		peerOrigin,
		publishRootsOf,
		splitOwnedRef,
		type ArchivePreview,
		type CreateNodeRequest,
		type FollowedIdentity,
		type ImportSettlement,
		type NodeAppearance,
		type NodeBulkAct,
		type NodeView,
		type PullView,
		type StoreRef,
		type Tag as TagName
	} from '@sloppy/types';
	import {
		AppearanceModal,
		branchesCarrying,
		CanvasInk,
		CanvasMenu,
		ChosenBar,
		ChosenLook,
		ChosenPublish,
		ChosenTags,
		ConfirmModal,
		DifferenceLegend,
		FindSheet,
		GraphsSheet,
		GraphSurface,
		GroundChoice,
		HeldNote,
		ImportSheet,
		namedBranches,
		nameOr,
		NotePreview,
		overlay,
		PeersSheet,
		personOr,
		ReadingPanel,
		ResponsiveModal,
		TagRail,
		TemplatePicker,
		WallpaperSheet,
		type CanvasMenuItem,
		type CanvasPen,
		type ConversationProps,
		type FoundNote,
		type HeldRegion,
		type NoteTemplate,
		type Peer,
		type PictureSource,
		type PreviewedNote,
		type ReactionPick,
		type ReferenceReader
	} from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import * as DropdownMenu from '@sloppy/ui/dropdown-menu';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onMount, untrack } from 'svelte';
	import { afterNavigate, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import PersonSurface from '../components/person-surface.svelte';
	import { api } from '../api.js';
	import { deletionCost, timeToPutBack } from '../deletion.js';
	import { noteEmoji, noteMedia, wallpaperMedia } from '../note-surface.js';
	import { saveHere, savesFiles } from '../save-file.js';
	import { canvasInk } from '../stores/canvas-ink.svelte.js';
	import { conversation } from '../stores/conversation.svelte.js';
	import { deleted } from '../stores/deleted.svelte.js';
	import { find } from '../stores/find.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { identity } from '../stores/identity.svelte.js';
	import { nodes, type WritingNote } from '../stores/nodes.svelte.js';
	import { outlineSections } from '../stores/outline-sections.svelte.js';
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { publications } from '../stores/publications.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import { tags } from '../stores/tags.svelte.js';
	import { openingWallpaper } from '../wallpaper.js';
	import GraphTree from './graph-tree.svelte';
	import HistorySurface from './history.svelte';
	import Note from './node.svelte';
	import Writing from './writing.svelte';
	import { citationUrl, nodeHref, refFromPath } from './routes.js';
	import {
		acceleratorFor,
		FIND_NOTE,
		NEW_BRANCH,
		opensFind,
		typedIntoWriting,
		WRITE_UNDER
	} from './shortcuts.js';

	let loading = $state(true);
	let canvas = $state<GraphHandle>();
	/** The note a deliberate act opened, for the canvas to come to. Held rather
	 *  than called straight through, because a note cited in the URL is asked for
	 *  before the surface that answers exists. */
	let bringingTo = $state<OwnedRef | null>(null);
	/** Whether the graphs this person keeps are being looked through. */
	let switching = $state(false);
	/** Whether a note is being looked for by number, title or a word in it. */
	let finding = $state(false);
	/** The graph itself is not here; it replaces the surface. */
	let unreachable = $state<string | null>(null);
	/** No note answered, and the canvas is drawing what this device kept. */
	let asLastRead = $state(false);
	/** A field that would not read while the others drew. Beside the graph, never
	 *  instead of it: one graph short must not cost the reader the rest. */
	let shortField = $state<string | null>(null);
	/** An action failed while the graph is fine; it sits beside the graph. */
	let refused = $state<string | null>(null);
	/** Where the reader was when opening another note was refused for want of
	 *  room: the strip, and the note in front of them. What that says is derived
	 *  from this rather than latched, because Back and Forward reach `openNotes`
	 *  through nothing this page runs — a message cleared by hand outlives them. */
	let refusedAt = $state<{ strip: readonly OwnedRef[]; reading: OwnedRef | null } | null>(null);
	/** A note asked for and not yet answered, with whatever has been typed into it
	 *  in the meantime. `from` is the note it springs from, which is also the tab
	 *  it takes; a branch takes the tab being read. */
	interface NoteBeingWritten {
		trip: WritingNote;
		from: OwnedRef | null;
		shape: NoteTemplate | null;
		/** Whether an address comes with it: a note written on its own carries
		 *  none until somebody writes one on it. */
		numbering: boolean;
		title: string;
		body: string;
		/** Which field the caret was in, so the note opens where it was left. */
		where: 'title' | 'body';
		/** Why it is not written yet, in words already fit to show. */
		refused: string | null;
	}
	let writing = $state<NoteBeingWritten | null>(null);
	/** Whether that note is what the reading surface is showing. A reader may step
	 *  off it onto another tab while it is still being answered. */
	let writingHere = $state(false);
	/** A branch whose number the person picked, which is asked for from the sheet
	 *  it was picked in: only there can a number the graph already carries be
	 *  picked again. */
	let numberingWrite = $state(false);
	const creating = $derived(writing !== null || numberingWrite);
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
	/** What was written into that note before it had an address, which it puts
	 *  down as its title and its first section. */
	let typed = $state<{
		ref: OwnedRef;
		title: string;
		body: string;
		where: 'title' | 'body';
	} | null>(null);
	/** Whether the note on the reading surface has a question of its own up. */
	let noteAsking = $state(false);
	/** The note a link is being pointed FROM, while the graph is the picker. */
	let pointing = $state<OwnedRef | null>(null);
	/** The strip held while the surface is out of the graph's way, so a question
	 *  put to the graph does not cost the reader the notes they had open. */
	let aside = $state<readonly OwnedRef[]>([]);
	/** The trail: what each entry behind the one being read holds — a note, or
	 *  `null` for the graph alone — oldest first, and what each entry ahead of it
	 *  holds, nearest first. */
	let behind = $state<readonly (OwnedRef | null)[]>([]);
	let ahead: readonly (OwnedRef | null)[] = [];
	/** What the entry being read holds. */
	let standing: OwnedRef | null = null;
	/** How long the trail was when the writing surface went up, so walking off
	 *  that entry takes the surface down with it. */
	let writingAt = 0;
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
	let publishing = $state(false);
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
	/** Somebody the peers sheet was raised about rather than opened on. */
	let asking = $state<{ identity: string; from?: string } | null>(null);
	/** Why the note citing a held one was not written. */
	let citeRefused = $state<string | null>(null);
	/**
	 * The held region on the canvas, or `null` for the reader's own graph. One
	 * author's graph is drawn at a time: an address is a place in the graph it
	 * was written in, so a peer's `1a` and the reader's own are two notes that
	 * seed identically and mean different things.
	 */
	let foreign = $state<PullView | null>(null);
	/** Whether the states this graph has been in are up. */
	let showingHistory = $state(false);
	/** A state the graph was in, drawn in place of the one it is in. Nothing on
	 *  the canvas writes while it is up. */
	let asWas = $state<{ commit: string; message: string; notes: NodeView[] } | null>(null);
	/** Two states set against each other, drawn on whichever of them is on the
	 *  canvas. */
	let comparing = $state<{ says: string; difference: GraphDifference } | null>(null);
	/** The held note being read, which the canvas also opens around. */
	let reached = $state<OwnedRef | null>(null);
	/** The held note whose sections are still on their way. */
	let reaching = $state<OwnedRef | null>(null);
	/** Whoever the reader tapped in a held note's conversation, until they close
	 *  them. */
	let meeting = $state<string | null>(null);
	/** Why the held note in front of the reader has no sections. */
	let reachRefused = $state<string | null>(null);

	const ownPictures: GraphPictures = { read: (upload) => api.ownPicture(upload) };

	const graph = $derived(graphs.current);
	const wallpaper = $derived(prefs.wallpaper(graph));
	let choosingWallpaper = $state(false);
	/** The picture up now. Written over when the app comes back from the
	 *  background, so the ground takes its turn while nobody is looking at it. */
	let showing = $derived(wallpaper ? (pictureTurn(wallpaper, Date.now()) ?? null) : null);

	/** A picture inside a held note. Publishing the branch is what made it
	 *  readable, and the fetch is the API's, so the author's instance never
	 *  learns who is reading. */
	const heldPictures: PictureSource = {
		held: true,
		picture: (upload) => api.publishedPicture(upload)
	};

	/** Where a reference inside a held note leads: the region either holds the
	 *  note it names or nothing does, since the reader's own graph is not the
	 *  one on screen. */
	const heldReferences: ReferenceReader = {
		read: async (note) => heldNotes.find((held) => held.ref === note) ?? null,
		open: (note) => {
			if (heldNotes.some((held) => held.ref === note)) void readHeld(note);
		}
	};

	/** The graphs on the canvas, in the order the reader put them there. */
	const onCanvas = $derived(graphs.onCanvas);
	/** Every branch drawn: those of each graph up, in the order the fields sit in. */
	const roots = $derived(onCanvas.flatMap((graph) => nodes.region({ graph })));
	const open = $derived(page.state.note ?? null);
	/** Every note open on the reading surface, in the order they were opened. */
	const openNotes = $derived<readonly OwnedRef[]>(page.state.notes ?? (open ? [open] : []));
	/** An address is read inside one graph, so a tab names its own only where a
	 *  note from a second one is open beside it. */
	const tabs = $derived.by(() => {
		const opened = openNotes.map((ref) => ({ ref, note: nodes.get(ref) }));
		const across = new Set(opened.flatMap(({ note }) => (note ? [graphOf(note)] : [])));
		return opened.map(({ ref, note }) => ({
			ref,
			...(note?.address === undefined ? {} : { address: note.address }),
			title: note?.title ?? '',
			graph: note && across.size > 1 ? graphs.titleOf(graphOf(note)) || 'Untitled' : null
		}));
	});
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
	/** The note being written, while it is the one the surface is showing. */
	const writingNow = $derived(writingHere ? writing : null);
	/** The tab the strip marks: the note on the surface, or, while one is being
	 *  written, the note it was asked under. A branch was asked for on the graph
	 *  rather than under any note open, so no tab is where the reader is. */
	const markedTab = $derived.by(() => {
		if (writingNow === null) return open;
		const from = writingNow.from;
		return from !== null && openNotes.includes(from) ? from : null;
	});
	const openNode = $derived(open ? nodes.get(open) : undefined);
	/** What the reading surface is called. The address leads, because that is what
	 *  a person cites and hands to a peer — PRODUCT.md § Design Principles 3. */
	const readingName = $derived(
		writingNow || !openNode
			? 'Note'
			: [openNode.address, openNode.title || 'Untitled'].filter(Boolean).join(' · ')
	);
	/** The address the graph has just handed the reader, said once. */
	const justNamed = $derived(naming ? (nodes.get(naming)?.address ?? '') : '');
	/** The note the reader came here from, where the entry behind this one holds
	 *  one the canvas is still drawing. At the head of the trail there is none,
	 *  and the way out of a note is the graph. */
	const wayBack = $derived.by(() => {
		const previous = behind.length > 0 ? behind[behind.length - 1] : null;
		if (previous === null || previous === open) return null;
		const note = nodes.get(previous);
		return note !== undefined && onCanvas.includes(graphOf(note)) ? previous : null;
	});
	const pointingNote = $derived(pointing ? nodes.get(pointing) : undefined);
	const heldNotes = $derived(foreign ? peers.held(foreign.ref) : []);
	const reachedNote = $derived(
		reached ? (heldNotes.find((note) => note.ref === reached) ?? null) : null
	);
	/** Whether what is on the canvas is a state that is not now — DESIGN.md § "A
	 *  difference between two states": there is nothing in one to act on. */
	const notNow = $derived(asWas !== null || comparing !== null);

	const populated = $derived.by(() => {
		if (asWas) return true;
		if (foreign) return heldNotes.length > 0;
		return !loading && !unreachable && roots.length > 0;
	});

	const visible = $derived.by(() => {
		if (asWas) return asWas.notes;
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

	/** The same, in a held region, where a peer reads one note at a time. */
	const heldReading = $derived(reached ? { open: new Set([reached]), active: reached } : undefined);

	/** The canvas a pen is drawing over: the reader's own graph, or the region
	 *  they went to read. */
	const inkedOn = $derived(foreign ? foreign.ref : graphs.current);
	const drawing = $derived(canvasInk.strokes(inkedOn));
	let fieldAt = $state<GraphTransform>();
	let inkPen = $state<CanvasPen>();

	$effect(() => {
		void canvasInk.restore(inkedOn);
	});

	/** What a surface over the graph acts on: the note a menu named, or every
	 *  note chosen — one note is a set of one, and takes the same acts. */
	const acted = $derived(oneNote ? [oneNote] : [...picked]);
	const actedNotes = $derived(
		acted.map((ref) => nodes.get(ref)).filter((note) => note !== undefined)
	);
	const actedTags = $derived([...new Set(actedNotes.flatMap((note) => note.tags))]);
	/** The chosen notes a publish sends out, which everything the question says
	 *  is counted over — the API acts on the same set. */
	const goingOut = $derived(
		publishRootsOf(actedNotes, (note) => publications.at(note) !== undefined)
	);
	/** The publication rooted at each of those, where there is one — what a
	 *  publish here sends another version of. A note that merely sits inside a
	 *  branch published from above has none, and publishing it opens one. */
	const chosenChains = $derived(
		goingOut.map((note) => publications.at(note)).filter((chain) => chain !== undefined)
	);
	const alreadyOut = $derived(chosenChains.length);
	/** True where one of those invites fewer people to answer than a first
	 *  publish does, which publishing again leaves as it is. */
	const keepsTerms = $derived(chosenChains.some((chain) => chain.comments !== 'anyone'));
	/** Branches rooted above the notes going out that already carry them, which
	 *  a publish here puts out a second time on terms of its own. */
	const carriedAbove = $derived(
		branchesCarrying(
			goingOut
				.filter((note) => publications.at(note) === undefined)
				.map((note) => publications.above(note))
				.filter((above) => above !== undefined)
		)
	);
	/** Branches under the notes going out that were published inviting fewer
	 *  people to answer, whose notes a publish here carries on its own terms. */
	const narrowerUnderChosen = $derived(
		namedBranches(
			goingOut.flatMap((note) =>
				publications.narrowerUnder(note, publications.at(note)?.comments ?? 'anyone')
			)
		)
	);
	/** What the publishing sheet says went wrong: the last act's refusal, or that
	 *  nothing could be read about what is already published. */
	const publishRefusal = $derived(
		actRefused ??
			(publications.state.failed && !publications.state.loaded
				? (publications.state.error ??
					'Sloppy could not check which of those notes are published. Try again in a moment.')
				: null)
	);
	const overGraph = $derived(overlay.open || menuAt !== null);

	/** A question put to the reader over this page, the open note's own included.
	 *  Not `overGraph`: where the reading panel cannot dock the note is a surface
	 *  too, and reading one is not being asked anything. */
	const asked = $derived(
		menuAt !== null ||
			choosingWallpaper ||
			deleting ||
			finding ||
			noteAsking ||
			numbering ||
			publishing ||
			shaping ||
			styling ||
			switching ||
			tagging ||
			visiting
	);

	/** Reading the graph as a walk rather than a canvas, which this device
	 *  remembers — DESIGN.md § Persistence. */
	const walking = $derived(prefs.current.walking);

	/** Pointing a link at a note is a question put to the canvas, so the canvas
	 *  comes back for as long as it is being asked. */
	const walkingNow = $derived(walking && !pointing);

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

	/** The rail is the legend for the graph on screen, so inside a region it
	 *  counts the region's notes rather than the reader's own. */
	const railTags = $derived.by(() => {
		if (!foreign) return tags.across(onCanvas);
		const counted: Record<string, number> = {};
		for (const note of heldNotes) {
			for (const tag of note.tags) counted[tag] = (counted[tag] ?? 0) + 1;
		}
		return Object.entries(counted)
			.map(([tag, notes]) => ({ tag, notes }))
			.sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
	});

	/** Notes carrying ANY of the selected tags, which is what the canvas lights. */
	const litNotes = $derived(
		selection.length === 0
			? []
			: visible.filter((note) => note.tags.some((tag) => selection.includes(tag)))
	);
	const lit = $derived(litNotes.length);

	const summary = $derived(
		selection.length > 0
			? `${lit.toLocaleString()} of ${count(visible.length, 'note', 'notes')} lit up`
			: foreign
				? count(visible.length, 'note', 'notes')
				: onCanvas.length > 1
					? `${count(visible.length, 'note', 'notes')} across ${count(onCanvas.length, 'graph', 'graphs')}`
					: heldIn(visible.length, roots)
	);

	function count(n: number, one: string, many: string): string {
		return `${n.toLocaleString()} ${n === 1 ? one : many}`;
	}

	/** A root carrying an address opens a branch; one carrying none opens no
	 *  branch and stands on its own, so the two are counted apart. */
	function heldIn(notes: number, roots: readonly NodeView[]): string {
		const held = count(notes, 'note', 'notes');
		const branches = roots.filter((root) => root.address !== undefined).length;
		const alone = roots.length - branches;
		if (alone === 0) return `${held} across ${count(branches, 'branch', 'branches')}`;
		const own = alone === 1 ? '1 on its own' : `${alone.toLocaleString()} on their own`;
		return branches === 0
			? `${held}, ${own}`
			: `${held}, ${count(branches, 'branch', 'branches')} and ${own}`;
	}

	const graphName = $derived(graphs.titleOf(graphs.current) || 'Your graph');
	/** How many other graphs are standing beside this one, where any are. */
	const besideIt = $derived(onCanvas.length > 1 ? `+${onCanvas.length - 1}` : null);

	/** An address is read inside one graph, so a row names its own only where
	 *  there is a second one on the canvas to tell it from. */
	const foundNotes = $derived.by<FoundNote[]>(() => {
		const several = onCanvas.length > 1;
		return find.found.map((hit) => ({
			ref: hit.note,
			address: hit.address,
			title: hit.title,
			graph: hit.held || !several ? null : graphs.titleOf(hit.graph) || 'Untitled',
			wasAt: hit.wasAt,
			snippet: hit.snippet,
			held: hit.held
		}));
	});

	function openFound(ref: OwnedRef): void {
		finding = false;
		show(ref);
	}

	$effect(() => {
		if (!finding) untrack(() => find.clear());
	});

	/** The deepest generation the canvas draws before the reader has looked
	 *  anywhere, which is one past where level of detail starts folding. */
	const FIRST_DRAWN_DEPTH = DEFAULT_BUDGET.depth + 1;

	/** What one graph's read left on the canvas. */
	interface FieldRead {
		/** Every note of the field arrived. One branch missing would leave the
		 *  counts under every mega-node wrong with nothing to say so. */
		whole: boolean;
		/** Any of its notes arrived: a field drawn from answers rather than from
		 *  what this device kept. */
		answered: boolean;
		error?: unknown;
	}

	async function loadField(graph: OwnedRef, enoughToDraw: () => void): Promise<FieldRead> {
		// The rail is the graph's legend, not the graph: a field whose tag counts
		// will not read still draws.
		void tags.load(graph).catch(() => {});
		let error: unknown;
		const branches = await nodes.load({ graph }).catch((err: unknown) => {
			error = err;
			return null;
		});
		if (!branches) return { whole: false, answered: false, error };
		const trees = await Promise.all(
			branches.map(async (root) => {
				// A bounded read first, so a graph of any size is on the canvas after
				// one: nothing deeper than this is drawn until the reader looks
				// somewhere. The rest of the branch follows, because what a mega-node
				// stands for is counted from the notes this device holds.
				await nodes
					.load({ origin: root.ref, maxDepth: FIRST_DRAWN_DEPTH })
					.then(enoughToDraw, () => {});
				return nodes.load({ origin: root.ref }).then(
					() => true,
					(err: unknown) => {
						error ??= err;
						return false;
					}
				);
			})
		);
		return { whole: trees.every(Boolean), answered: true, error };
	}

	async function loadGraph(): Promise<void> {
		// A graph is one person's, and which graphs are on the canvas is read
		// against whose they are, so nothing is asked for until that is known.
		if (!session.viewer) return;
		unreachable = null;
		shortField = null;
		asLastRead = false;
		// Which graphs stand on the canvas is read against the ones this person
		// keeps, so what the device holds of both comes back before either is asked
		// for — DESIGN.md § Persistence.
		await Promise.all([graphs.restore(), nodes.restore()]);
		// What the graphs are called is chrome: one whose name did not arrive still
		// draws, and the sheet that lists them is where that is said. Which graph
		// the reader is IN is not — every home graph's ulid is its own, so a device
		// that kept no listing has to be told before it can ask for anything.
		const listing = graphs.load().catch(() => {});
		if (graphs.current === '') await listing;
		const fields = onCanvas;
		// A field with anything on it draws while the rest arrives; only a canvas
		// with nothing on it yet is worth a skeleton.
		loading = !fields.some(
			(graph) => nodes.status({ graph }).loaded || nodes.region({ graph }).length > 0
		);
		// Each on its own, because one field that will not read must not cost the
		// others theirs — `node.svelte`'s `reachEveryGraph` reads them the same way.
		const reads = await Promise.all(
			fields.map((graph) =>
				loadField(graph, () => (loading = false)).then((read) => ({ graph, ...read }))
			)
		);
		loading = false;
		const short = reads.filter((read) => !read.whole);
		if (short.length === 0) return;
		if (!reads.some((read) => read.answered)) {
			if (fields.some((graph) => nodes.region({ graph }).length > 0)) {
				asLastRead = true;
				return;
			}
			unreachable =
				serverMessage(short[0].error) ??
				`Sloppy could not reach ${fields.length > 1 ? 'those graphs' : 'your graph'}. Try again in a moment.`;
			return;
		}
		if (short.some((read) => read.answered)) {
			shortField = 'Some notes could not be read. Everything else on the canvas is here.';
			return;
		}
		// What the graphs are called may not have arrived either, so one with no
		// name yet is still said — just not by name.
		const named = short.length === 1 ? graphs.titleOf(short[0].graph) : '';
		shortField = named
			? `${named} could not be read. Everything else on the canvas is here.`
			: `${short.length === 1 ? 'A graph' : 'Some graphs'} on the canvas could not be read. Everything else is here.`;
	}

	// A note reached by its address arrives in the URL and nowhere else, at either
	// moment this page can arrive at one: mounting on it, or a navigation landing
	// on it — which settles `page.state` last, after any mount it caused.
	function openCited(): void {
		const cited = refFromPath(page.url.pathname);
		if (!cited) return;
		if (!page.state.note) stayAt('', { note: cited, notes: [cited] });
		bringingTo = cited;
		void reachCited(cited);
	}

	/** A note cited by its address is in whichever graph its author filed it in,
	 *  so reaching one is what moves the reader into that graph — a folder
	 *  somebody shared opens here like any other graph of the reader's. One in a
	 *  graph they do not keep is read in the region they hold a copy of it in. */
	async function reachCited(cited: OwnedRef): Promise<void> {
		await graphs.load().catch(() => {});
		if (session.signedIn && !graphs.keeps(splitOwnedRef(cited).did)) {
			await reachHeld(cited);
			return;
		}
		openInPlace(cited);
		const note = nodes.get(cited) ?? (await nodes.fetch(cited).catch(() => null));
		if (note && !graphs.onCanvas.includes(graphOf(note))) graphs.enter(graphOf(note));
	}

	/** Somebody else's note: the region holding it, opened at the note itself.
	 *  Held by nobody here, the branch that carries it is what to offer instead. */
	async function reachHeld(cited: OwnedRef): Promise<void> {
		if (session.onDevice) {
			hide();
			refused =
				"That note is somebody else's. This graph is on your device, so only what is in it opens here.";
			return;
		}
		const hit = await peers.heldNote(cited);
		hide();
		if (hit) {
			await enterRegion(hit.pull.ref);
			await readHeld(hit.note.ref);
			return;
		}
		const who = splitOwnedRef(cited).did;
		const followed = peers.following.find((one) => one.did === who);
		const from = followed && readAt(followed);
		asking = { identity: who, ...(from ? { from } : {}) };
		visitPeers();
	}

	/** The notes the canvas has stopped drawing, closed with the field they were
	 *  read beside: a note open over a canvas that no longer holds its graph is
	 *  one surface showing two. */
	function closeUndrawn(): void {
		const drawing = new Set(graphs.onCanvas);
		closeGone(
			openNotes.filter((of) => {
				const note = nodes.get(of);
				return note !== undefined && !drawing.has(graphOf(note));
			})
		);
	}

	onMount(() => {
		openCited();
		if (!session.onDevice) void peers.load();
		const back = (): void => {
			if (document.visibilityState === 'visible' && wallpaper) {
				showing = pictureTurn(wallpaper, Date.now()) ?? null;
			}
		};
		document.addEventListener('visibilitychange', back);
		return () => document.removeEventListener('visibilitychange', back);
	});

	// A graph the reader has moved into, or stood up beside the one they were
	// reading, is a field with nothing in it until it has been read.
	$effect(() => {
		void onCanvas;
		void session.viewer;
		untrack(() => void loadGraph());
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

	$effect(() => {
		const ref = bringingTo;
		const surface = canvas;
		if (ref === null || surface === undefined) return;
		surface.bringTo(ref);
		untrack(() => (bringingTo = null));
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
		behind = [...behind, standing];
		ahead = [];
		standing = ref;
		bringingTo = ref;
		pushState(nodeHref(ref), { note: ref, notes: [...strip] });
	}

	/** The entry being read, made to say something else. Tidying up is not
	 *  somewhere the reader went, so the trail does not grow by it. */
	function stayAt(path: string, state: App.PageState): void {
		standing = state.note ?? null;
		replaceState(path, state);
	}

	function walkBack(): void {
		if (wayBack !== null) history.back();
	}

	// `goTo` is the only thing that adds an entry and `stayAt` the only thing that
	// changes the one being read, so `open` changing without either is the reader
	// walking the trail, and the two above are squared up against it here.
	$effect(() => {
		const now = open;
		untrack(() => {
			if (now !== standing) {
				if (behind.length > 0 && behind[behind.length - 1] === now) {
					ahead = [standing, ...ahead];
					behind = behind.slice(0, -1);
				} else if (ahead.length > 0 && ahead[0] === now) {
					behind = [...behind, standing];
					ahead = ahead.slice(1);
				}
				standing = now;
			}
			// The writing surface holds the only copy of what is typed into it, so
			// it survives the entry it went up on being replaced — but not the
			// reader walking off that entry.
			if (writingHere && behind.length !== writingAt) leaveWriting();
		});
	});

	/** Off the writing surface and onto a note. A note still being answered is on
	 *  its way and opens where it lands; a refused one was never written at all,
	 *  so it goes with the surface it was refused on. */
	function leaveWriting(): void {
		if (writing?.refused) writing = null;
		writingHere = false;
	}

	/** `wrote` marks a note just written, whose title is still to be given: `from`
	 *  is the note it was written from, or nothing where it began a branch, and
	 *  `typed` is what was written into it before it had an address. */
	function show(
		ref: OwnedRef,
		wrote: {
			from: OwnedRef | null;
			shape: NoteTemplate | null;
			typed?: { title: string; body: string; where: 'title' | 'body' };
		} | null = null
	): void {
		naming = wrote ? ref : null;
		seed = wrote?.shape ? { ref, shape: wrote.shape } : null;
		typed =
			wrote?.typed && (wrote.typed.title || wrote.typed.body) ? { ref, ...wrote.typed } : null;
		leaveWriting();
		refused = null;
		openInPlace(ref);
		goTo(ref, inPlaceOf(ref, wrote?.from ?? null));
	}

	/** The outline reads a note where the note stands, so one reached while the
	 *  walk is up opens under its own row rather than beside the graph. */
	function openInPlace(ref: OwnedRef): void {
		if (walking) outlineSections.show(ref, true);
	}

	/** A note's own page, which is off the outline: the walk reads and arranges,
	 *  and what it does not draw — the look, the links, publishing — is read
	 *  beside the graph. */
	function openPage(ref: OwnedRef): void {
		prefs.set('walking', false);
		show(ref);
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
		typed = null;
		leaveWriting();
		goTo(ref, [...openNotes, ref]);
	}

	function activate(ref: OwnedRef): void {
		// The tab a reader is already on is the way back off the writing surface,
		// so it steps off before there is nowhere left to go.
		leaveWriting();
		if (ref === open) return;
		naming = null;
		seed = null;
		typed = null;
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
		typed = null;
		leaveWriting();
		stayAt(nodeHref(next), { note: next, notes: left });
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
		typed = null;
		leaveWriting();
		stayAt(nodeHref(next), { note: next, notes: left });
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
		typed = null;
		leaveWriting();
		aside = held;
		stayAt('/', {});
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

	/** Everything the reader had going on the graph as it is, put away before a
	 *  state that is not now goes on the canvas. */
	function stopActing(): void {
		stopChoosing();
		stopPointing();
		hide();
	}

	function backToNow(): void {
		asWas = null;
		comparing = null;
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
		// Read before the act, since a delete takes the notes out of the cache
		// this reads their graph from.
		const acrossGraphs = graphsOf(asked);
		let missed: number;
		try {
			missed = (await nodes.act({ notes: asked, act })).missed;
		} catch (error) {
			// Each note is published on its own, so a request that stops partway
			// leaves some of them out and the canvas a version behind.
			if (act.act === 'publish') refreshPublished(asked);
			actRefused =
				serverMessage(error) ??
				(act.act === 'publish'
					? 'Sloppy could not finish publishing those notes. Some of them may be out. Try again in a moment.'
					: 'Sloppy could not change those notes. Try again in a moment.');
			throw error;
		}
		const shortfall =
			missed === 0
				? null
				: act.act === 'publish'
					? didNotGoOut(missed, asked.length)
					: alreadyGone(missed, asked.length);
		// A tag exists as long as a note carries one, so the rail's counts are stale
		// the moment notes are tagged — or taken away with the tags they carried.
		if (act.act !== 'set_appearance' && act.act !== 'publish') {
			for (const graph of acrossGraphs) void tags.reload(graph).catch(() => {});
		}
		if (act.act === 'publish') {
			actMissed = shortfall;
			refreshPublished(asked);
			return;
		}
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

	/** The graphs a set of notes lies in, of the ones still cached. */
	function graphsOf(asked: readonly OwnedRef[]): OwnedRef[] {
		return [
			...new Set(
				asked
					.map((ref) => nodes.get(ref))
					.filter((note) => note !== undefined)
					.map(graphOf)
			)
		];
	}

	/**
	 * A publish moves more marks than the notes it was asked about: every note
	 * under a published root draws as published too, and what this person
	 * publishes is read on surfaces this one does not draw.
	 */
	function refreshPublished(asked: readonly OwnedRef[]): void {
		const origins = new Set(
			asked.map((ref) => nodes.get(ref)?.origin).filter((origin) => origin !== undefined)
		);
		for (const origin of origins) void nodes.reload({ origin }).catch(() => {});
		void publications.reload().catch(() => {});
	}

	/** A chosen note that already had versions behind it is still published when
	 *  a fresh one does not land, so what is said is about this act. */
	function didNotGoOut(missed: number, asked: number): string {
		if (asked === 1) return 'That note did not go out.';
		return missed === 1
			? 'One of the notes you chose did not go out.'
			: `${missed.toLocaleString()} of the notes you chose did not go out.`;
	}

	function alreadyGone(missed: number, asked: number): string {
		if (asked === 1) return 'That note was already gone.';
		return missed === 1
			? 'One of the notes you chose was already gone.'
			: `${missed.toLocaleString()} of the notes you chose were already gone.`;
	}

	/** The notes the selection lit, as one act can take them. The row counts what
	 *  it reaches, so a set over the bound is answered before the tap. */
	const chooseLit = $derived.by((): CanvasMenuItem | null => {
		if (lit === 0) return null;
		const reach = litNotes.slice(0, MAX_NOTES_PER_BULK_ACT).map((note) => note.ref);
		const label =
			reach.length < lit
				? `Choose ${reach.length.toLocaleString()} of the ${count(lit, 'note', 'notes')} lit up`
				: lit === 1
					? 'Choose the note lit up'
					: `Choose the ${count(lit, 'note', 'notes')} lit up`;
		return { label, icon: Hash, onSelect: () => chooseWithin(reach) };
	});

	const menuItems = $derived.by((): CanvasMenuItem[] => {
		const at = menuAt;
		if (!at) return [];
		const on = at.ref;
		if (!choosing) {
			if (!on) {
				const bare: CanvasMenuItem[] = [
					{ label: 'New branch', icon: Plus, onSelect: () => writeBranch(null) },
					{ label: 'New note', icon: FilePlus, onSelect: writeAlone },
					{ label: 'Choose notes', icon: ListChecks, onSelect: startChoosing }
				];
				return chooseLit ? [chooseLit, ...bare] : bare;
			}
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
				...(session.onDevice
					? []
					: [
							{
								label: picked.size === 1 ? 'Publish it' : `Publish these ${picked.size}`,
								icon: Globe,
								onSelect: openPublish
							}
						]),
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
			{
				label: 'Write a note under this',
				icon: CornerDownRight,
				onSelect: () => writeUnder(on)
			},
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

	/** Always the chosen set: one note is published from its own page, where the
	 *  versions of it are. */
	function openPublish(): void {
		oneNote = null;
		forgetLastAct();
		publishing = true;
	}

	function askToDelete(one: OwnedRef | null): void {
		oneNote = one;
		forgetLastAct();
		deletingCount = acted.length;
		deletionSays = deletionCost(acted);
		deleting = true;
	}

	/** A branch of its own, in the graph the reader is in — against
	 *  {@link writeUnder}, which continues the note it is given. */
	function writeBranch(shape: NoteTemplate | null): void {
		startWriting({ from: { relation: 'branch', graph: graphs.current } }, null, shape);
	}

	/** A note that springs from nothing and carries no address until the reader
	 *  writes one on it. */
	function writeAlone(): void {
		startWriting({ from: { relation: 'free', graph: graphs.current } }, null, null);
	}

	/** The note that springs from one already on the canvas, without opening it
	 *  first. */
	function writeUnder(on: OwnedRef): void {
		startWriting({ from: { relation: 'under', note: on } }, on, null);
	}

	/** The surface opens on the asking, not on the answer: what is typed into it
	 *  before the address lands goes to the note the moment there is one. It opens
	 *  in the tab the note will land in, so the strip says where the reader is. */
	function startWriting(
		asked: CreateNodeRequest,
		from: OwnedRef | null,
		shape: NoteTemplate | null
	): void {
		if (creating) return;
		refused = null;
		if (from !== null && from !== open && openNotes.includes(from)) activate(from);
		writingAt = behind.length;
		writing = {
			trip: nodes.write(asked),
			from,
			shape,
			numbering: asked.from?.relation !== 'free',
			title: '',
			body: '',
			where: 'title',
			refused: null
		};
		writingHere = true;
		void whenWritten(writing);
	}

	async function whenWritten(job: NoteBeingWritten): Promise<void> {
		try {
			const written = await job.trip.note;
			writing = null;
			show(written.ref, {
				from: job.from,
				shape: job.shape,
				typed: { title: job.title, body: job.body, where: job.where }
			});
		} catch (error) {
			job.refused = serverMessage(error) ?? 'Sloppy could not add that note.';
			// Back in front of the reader wherever they went: it holds the only copy
			// of what they wrote, and the way to ask again.
			writingHere = true;
		}
	}

	function writeAgain(): void {
		const job = writing;
		if (!job) return;
		job.refused = null;
		job.trip = job.trip.again();
		void whenWritten(job);
	}

	const writeFromRow = {
		keys: WRITE_UNDER.keys,
		typed: (event: KeyboardEvent) => acceleratorFor(event) === 'under',
		write: (on: OwnedRef) => writeUnder(on),
		beside: (on: OwnedRef) => startWriting({ from: { relation: 'after', note: on } }, on, null)
	};

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
		closeHeld();
		foreign = region;
		await peers.enter(ref);
	}

	function leaveRegion(): void {
		foreign = null;
		closeHeld();
	}

	/** A held note, opened to be read. Its sections are asked for once, and a
	 *  second note opened while the first is still coming settles last. */
	async function readHeld(ref: OwnedRef): Promise<void> {
		reached = ref;
		bringingTo = ref;
		reachRefused = null;
		if (peers.hasStack(ref)) return;
		reaching = ref;
		const stack = await peers.read(ref);
		if (reached !== ref) return;
		reaching = null;
		if (stack === null) {
			reachRefused = peers.says ?? 'Sloppy could not read that note. Try again in a moment.';
		}
	}

	function closeHeld(): void {
		reached = null;
		reaching = null;
		reachRefused = null;
		citeRefused = null;
	}

	/** Whether the note citing a held one is being written, so a second tap on
	 *  the act does not write a second note. */
	let citing = false;

	/** A note of the reader's own that cites a held one: theirs, in the notebook
	 *  they are keeping, and starting from the note they were reading. */
	async function writeCiting(held: OwnedRef): Promise<void> {
		if (citing || creating) return;
		citing = true;
		citeRefused = null;
		try {
			const written = await nodes.create({
				from: { relation: 'branch', graph: graphs.current }
			});
			try {
				await nodes.update(written.ref, { links: [held] });
			} catch (error) {
				await nodes.remove(written.ref).catch(() => {});
				throw error;
			}
			closeHeld();
			leaveRegion();
			show(written.ref, { from: null, shape: null });
		} catch (error) {
			citeRefused = serverMessage(error) ?? 'Sloppy could not add that note.';
		} finally {
			citing = false;
		}
	}

	/**
	 * Whether the reader may answer the note in front of them: the author's
	 * invitation as the copy carries it, held by somebody whose own identity is
	 * kept where a conversation can be. Anyone allowed to answer may answer
	 * whoever wrote it — PRODUCT.md § "A peer".
	 */
	const answerable = $derived(
		foreign !== null && foreign.comments === 'anyone' && identity.converses
	);

	const conversationPeople = {
		of: (did: string) => people.of(did),
		unplaced: (did: string) => people.unplaced(did),
		resolve: (did: string) => people.resolve(did)
	};

	const readerEmoji = $derived(noteEmoji(session.viewer?.did ?? ''));

	const heldConversation = $derived.by<ConversationProps | null>(() => {
		const note = reached;
		if (note === null || !answerable) return null;
		const state = conversation.status(note);
		return {
			comments: conversation.comments(note),
			reactions: conversation.reactions(note),
			mine: session.viewer?.did ?? '',
			people: conversationPeople,
			emoji: readerEmoji,
			loading: state.loading,
			unreadable: state.failed
				? (state.error ?? 'Sloppy could not read what people said. Try again in a moment.')
				: null,
			onsay: (content: string, replyTo: StoreRef | undefined) =>
				inTheirWords(
					() =>
						conversation.say({
							node: note,
							content,
							...(replyTo === undefined ? {} : { reply_to: replyTo })
						}),
					'That could not be posted. Try again in a moment.'
				),
			onunsay: (commentId: StoreRef) =>
				inTheirWords(
					() => conversation.unsay(note, commentId),
					'That could not be removed. Try again in a moment.'
				),
			onreact: (pick: ReactionPick) =>
				inTheirWords(
					() => conversation.react({ node: note, ...pick }),
					'That reaction could not be added. Try again in a moment.'
				),
			onunreact: (reactionId: StoreRef) =>
				inTheirWords(
					() => conversation.unreact(note, reactionId),
					'That reaction could not be removed. Try again in a moment.'
				),
			onperson: (who: string) => void (meeting = who)
		};
	});

	/** Thrown on so the surface that asked shows the answer where it was asked,
	 *  in the server's own words where it gave any. */
	async function inTheirWords(act: () => Promise<unknown>, otherwise: string): Promise<void> {
		try {
			await act();
		} catch (error) {
			throw new Error(serverMessage(error) ?? otherwise, { cause: error });
		}
	}

	// Whoever the sheet was raised about is who it was raised about that once:
	// the next reader to open it opened it themselves.
	$effect(() => {
		if (!visiting) asking = null;
	});

	let taking = $state(false);

	async function takeArchive(): Promise<void> {
		if (taking) return;
		refused = null;
		if (!savesFiles()) {
			refused =
				"Taking this graph as a file isn't available here yet. Open Sloppy in a browser to take one.";
			return;
		}
		taking = true;
		try {
			const { bytes, filename } = await graphs.exportArchive(graph);
			await saveHere(filename, new Blob([bytes as BlobPart], { type: 'application/zip' }));
		} catch (error) {
			refused =
				serverMessage(error) ??
				'That graph could not be put in a file just now. Try again in a moment.';
		} finally {
			taking = false;
		}
	}

	/** The file picker for a graph somebody is bringing in. */
	let chooser = $state<HTMLInputElement>();
	/** The archive in hand, held while its preview is read and answered. */
	let arriving = $state<{
		file: File;
		preview: ArchivePreview | null;
		reading: boolean;
		busy: boolean;
		refused: string | null;
	} | null>(null);

	async function readArchive(file: File | undefined): Promise<void> {
		if (!file) return;
		arriving = { file, preview: null, reading: true, busy: false, refused: null };
		const held = arriving;
		try {
			const preview = await graphs.previewImport(file);
			if (arriving === held) arriving = { ...held, preview, reading: false };
		} catch (error) {
			if (arriving === held) {
				arriving = {
					...held,
					reading: false,
					refused: serverMessage(error) ?? 'That file could not be read as a graph.'
				};
			}
		}
	}

	async function bringItIn(settle: ImportSettlement | undefined): Promise<void> {
		if (!arriving) return;
		arriving = { ...arriving, busy: true, refused: null };
		const held = arriving;
		try {
			const brought = await graphs.importArchive(held.file, settle);
			if (arriving === held) arriving = null;
			closeUndrawn();
			await nodes.reload({ graph: brought.ref }).catch(() => {});
			void tags.reload(brought.ref).catch(() => {});
		} catch (error) {
			if (arriving !== held) return;
			arriving = {
				...held,
				busy: false,
				refused: serverMessage(error) ?? 'That graph could not be brought in just now.'
			};
		}
	}

	/** Other people's graphs, and a second look at whatever did not arrive the
	 *  first time. */
	function visitPeers(): void {
		visiting = true;
		void peers.load();
		void peers.loadAnswered();
	}

	/** Whose graph a held region copies: a publication is its author's, so their
	 *  identity is one half of its reference. */
	const authorOf = (region: PullView) => splitOwnedRef(region.publication).did;

	const heldRegions = $derived<HeldRegion[]>(
		peers.regions.map((region) => ({
			ref: region.ref,
			publication: region.publication,
			identity: authorOf(region),
			person: people.of(authorOf(region)),
			unplaced: people.unplaced(authorOf(region)),
			address: region.root_address,
			version: region.version,
			readAt: region.updated_at,
			...(region.graph === undefined ? {} : { graph: region.graph }),
			...(region.graph_title === undefined ? {} : { notebook: region.graph_title }),
			from: region.source_url
		}))
	);

	/** Where to ask about somebody: the instance a region of theirs came from,
	 *  else the provider the reader's own store recorded beside their DID. A DID
	 *  names a person and never a place, so neither is more than a best guess,
	 *  and the sheet shows which was used. */
	function readAt(one: FollowedIdentity): string | undefined {
		const held = peers.regions.find((region) => authorOf(region) === one.did);
		return held?.source_url ?? peerOrigin(one.provider_url ?? '') ?? undefined;
	}

	const followedPeople = $derived<Peer[]>(
		peers.following.map((one) => ({
			identity: one.did,
			person: people.of(one.did),
			unplaced: people.unplaced(one.did),
			from: readAt(one)
		}))
	);

	/** The reader's own notes strangers answered, in the notebooks they were
	 *  written in. */
	const answeredNotes = $derived(
		peers.answered.map((answer) => ({
			note: answer.note,
			address: answer.address,
			title: answer.title,
			graph: answer.graph,
			...(graphs.titleOf(answer.graph) ? { notebook: graphs.titleOf(answer.graph) } : {}),
			voices: answer.voices.map((did) => ({
				identity: did,
				person: people.of(did),
				unplaced: people.unplaced(did)
			}))
		}))
	);

	/** Whoever a peer surface is about to name, asked for once. */
	$effect(() => {
		for (const one of peers.following) people.resolve(one.did);
		for (const region of peers.regions) people.resolve(authorOf(region));
		for (const answer of peers.answered) for (const voice of answer.voices) people.resolve(voice);
	});

	// Where the reader's identity is kept decides whether a held note is offered
	// a conversation at all, so it is asked before one is drawn.
	$effect(() => {
		if (session.signedIn && !session.onDevice) void identity.load();
	});

	// What is already published decides what a publish of the chosen set widens,
	// so it is read before the question is asked and not at it.
	$effect(() => {
		if (session.signedIn && !session.onDevice) void publications.load().catch(() => {});
	});

	$effect(() => {
		if (answerable && reached) void conversation.load(reached);
	});

	const regionAuthor = $derived(
		foreign
			? personOr({
					identity: authorOf(foreign),
					person: people.of(authorOf(foreign)),
					unplaced: people.unplaced(authorOf(foreign))
				})
			: null
	);
	/** A note's shortcodes are read against its own author's catalog, which this
	 *  instance resolves. */
	const heldEmoji = $derived(readerEmoji.catalog);

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
		numberingWrite = true;
		numberRefused = null;
		try {
			const written = await nodes.create({
				from: { relation: 'root', address: picked.data, graph: graphs.current }
			});
			numbering = false;
			show(written.ref, { from: null, shape: null });
		} catch (error) {
			numberRefused =
				serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			numberingWrite = false;
		}
	}
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<svelte:window
	onkeydowncapture={(event) => {
		if (event.key !== 'Escape') return;
		// A field answers its own Escape by emptying itself, and the reader who
		// typed into it did not ask the graph anything.
		if (typedIntoWriting(event)) return;
		if (pointing) stopPointing();
		// Capture, so this reads whether a surface is over the graph BEFORE that
		// surface closes itself on the same keystroke — otherwise one Escape both
		// puts the question away and ends what it was asked about.
		else if (choosing && !overGraph) stopChoosing();
	}}
	onkeydown={(event) => {
		// Last resort: a row of the walk answers these keys for the note it is on,
		// and has refused the default by the time they reach here.
		if (event.defaultPrevented || asked || pointing || foreign || notNow) return;
		if (opensFind(event)) {
			event.preventDefault();
			finding = true;
			return;
		}
		if (typedIntoWriting(event)) return;
		const act = acceleratorFor(event);
		if (act === 'branch') {
			event.preventDefault();
			writeBranch(null);
		} else if (act === 'under' && open) {
			event.preventDefault();
			writeUnder(open);
		}
	}}
/>

{#snippet walk()}
	<!-- Out of the chrome while a set is being chosen: the bar over that set acts
	     on notes the tree does not mark. -->
	{#if !choosing}
		{#if !walking}
			<Button
				variant="ghost"
				size="icon"
				class="size-9 shrink-0 rounded-full"
				aria-label="See everything on the canvas"
				onclick={() => canvas?.fit()}
			>
				<Maximize class="size-4" />
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="size-9 shrink-0 rounded-full"
			aria-label={walking ? 'Back to the graph' : 'Walk the notes one at a time'}
			onclick={() => prefs.set('walking', !walking)}
		>
			{#if walking}
				<Network class="size-4" />
			{:else}
				<ListTree class="size-4" />
			{/if}
		</Button>
	{/if}
{/snippet}

<!-- Only where there is something to take back: a pen is how a drawing starts,
     so nothing here has to be found first. -->
{#snippet inkActs()}
	{#if drawing.length > 0}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="size-9 shrink-0 rounded-full"
						aria-label="Your drawing"
					>
						<PenLine class="size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="end" class="w-52">
				<DropdownMenu.Item class="min-h-11" onSelect={() => canvasInk.undo(inkedOn)}>
					Undo the last stroke
				</DropdownMenu.Item>
				<DropdownMenu.Item class="min-h-11" onSelect={() => canvasInk.rubOut(inkedOn)}>
					Rub the drawing out
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
{/snippet}

<div class="viewport-fit relative mr-[var(--reading-dock-inset-right,0px)]">
	<h1 class="sr-only">Your graph</h1>
	<p class="sr-only" role="status">{justNamed ? `Your new note is ${justNamed}.` : ''}</p>

	{#if populated}
		<!-- DESIGN.md § "The canvas": never a scroller, and the ground is the
		     page's — the field is inset off the chrome rather than stopping the
		     picture at it. -->
		<div class="absolute inset-0">
			<!-- The canvas stays mounted while the tree is up: tearing it down would take
			     the reader's pan, their zoom and a settled layout with it, and it is the
			     same graph they come back to. -->
			<div class="absolute inset-0" class:invisible={walkingNow} inert={walkingNow}>
				<GraphSurface
					bind:handle={canvas}
					inset={{ top: `${railHeight}px`, bottom: 'var(--sysnav-clearance)' }}
					nodes={visible}
					{collapsed}
					{selection}
					fields={foreign || asWas ? undefined : graphs.fields}
					viewer={session.viewer?.did}
					remountKey={asWas ? asWas.commit : foreign?.ref}
					focus={asWas
						? undefined
						: foreign
							? (reached ?? undefined)
							: (open ?? looking ?? undefined)}
					picking={pointing && pointingNote
						? {
								from: pointing,
								taken: new Set(pointingNote.links),
								onPick: (ref) => void pointAt(ref)
							}
						: undefined}
					pictures={ownPictures}
					reading={asWas ? undefined : foreign ? heldReading : reading}
					ground={prefs.current.ground}
					wallpaper={{
						picture: showing,
						strength: wallpaper?.strength ?? 0,
						transition: wallpaper?.transition
					}}
					difference={comparing?.difference}
					onHover={(at) => (hoverAt = overGraph || notNow ? null : at)}
					chosen={foreign || notNow ? undefined : chosen}
					onChoose={pointing || foreign || notNow ? undefined : chooseAlso}
					onChooseWithin={pointing || foreign || notNow ? undefined : chooseWithin}
					onMenu={pointing || foreign || notNow ? undefined : (at) => (menuAt = at)}
					onOpenNode={notNow
						? (ref) => (bringingTo = ref)
						: foreign
							? (ref) => void readHeld(ref)
							: show}
					onExpand={(ref) => {
						folded.delete(ref);
						if (pointing) looking = ref;
					}}
					onCollapse={(ref) => folded.add(ref)}
					onInkPointer={pointing || notNow ? undefined : inkPen}
					onTransform={(at) => (fieldAt = at)}
				/>
				<CanvasInk
					layer={canvas?.ink}
					transform={fieldAt}
					strokes={drawing}
					ondrawn={(stroke) => canvasInk.add(inkedOn, stroke)}
					bind:pen={inkPen}
				/>
			</div>

			{#if walkingNow}
				<GraphTree
					inset={{
						top: `${railHeight}px`,
						bottom: 'calc(var(--sysnav-clearance) + var(--chosen-bar-inset-bottom, 0px))'
					}}
					notes={visible}
					fields={foreign || asWas ? undefined : graphs.fields}
					{selection}
					reading={asWas ? null : foreign ? reached : open}
					opened={unfolded}
					chosen={foreign || notNow ? undefined : chosen}
					onChoose={foreign || notNow ? undefined : chooseAlso}
					onChoosing={foreign || notNow
						? undefined
						: (on) => (on ? startChoosing() : stopChoosing())}
					onToggle={(ref, open) => (open ? unfolded.add(ref) : unfolded.delete(ref))}
					onOpen={notNow
						? (ref) => (bringingTo = ref)
						: foreign
							? (ref) => void readHeld(ref)
							: openPage}
					onReached={(ref) => (bringingTo = ref)}
					writeUnder={foreign || notNow ? undefined : writeFromRow}
					writeAlone={foreign || notNow ? undefined : writeAlone}
				/>
			{/if}
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
							{graphs.several ? `${graphName} starts` : 'Your graph starts'} with one note, and everything
							else grows out of it.
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
							<Button variant="ghost" class="h-11" onclick={() => chooser?.click()}>
								Import a graph
							</Button>
							<Button variant="ghost" class="h-11" onclick={() => (switching = true)}>
								Your graphs
							</Button>
							{#if !session.onDevice}
								<Button variant="ghost" class="h-11" onclick={visitPeers}>
									Read somebody else's
								</Button>
							{/if}
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
		<!-- What only changes how the canvas is looked at sits on the canvas, at a
		     weight below the row that writes — DESIGN.md § Layout. -->
		{#if !walkingNow && !choosing && !pointing}
			<div
				style="top: {railHeight}px; bottom: var(--sysnav-clearance)"
				class="pointer-events-none absolute right-2 z-20 flex items-center sm:right-4"
			>
				<div
					class="pointer-events-auto flex flex-col items-center gap-0.5 rounded-full border bg-card/90 p-1 shadow-sm backdrop-blur"
				>
					{@render walk()}
					{@render inkActs()}
					<GroundChoice
						value={prefs.current.ground}
						pictured={wallpaper !== null}
						onchange={(ground) => prefs.set('ground', ground)}
						onpicture={() => (choosingWallpaper = true)}
					/>
				</div>
			</div>
		{/if}
		<!-- Opaque, not a scrim: the chips in here answer a tag question in the
		     same hue the canvas does, and DESIGN.md § "The wallpaper" holds that
		     floor on the theme's own surface rather than on a band. -->
		<div
			bind:clientHeight={railHeight}
			class="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-5 sm:px-6"
		>
			<div
				class="pointer-events-auto mx-auto w-full max-w-4xl space-y-2 rounded-2xl border bg-card p-3 shadow-lg"
			>
				{#if pointing}
					<div class="flex items-center gap-3">
						<p class="min-w-0 flex-1 text-sm">
							Tap a note to link it to <span class:address={!!pointingNote?.address}
								>{pointingNote ? noteLabel(pointingNote) : ''}</span
							>
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
				{:else if comparing}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p class="w-full min-w-0 text-sm sm:w-auto sm:flex-1">
							What changed
							<span class="text-muted-foreground">· {comparing.says}</span>
						</p>
						<Button
							variant="ghost"
							class="ms-auto h-9 shrink-0 rounded-full"
							onclick={() => (showingHistory = true)}
						>
							In words
						</Button>
						<Button variant="outline" class="h-9 shrink-0 rounded-full" onclick={backToNow}>
							Your graph now
						</Button>
						{#if walkingNow}
							{@render walk()}
						{/if}
					</div>
				{:else if asWas}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p class="w-full min-w-0 text-sm sm:w-auto sm:flex-1">
							Your graph as it was
							{#if asWas.message}
								<span class="text-muted-foreground">· {asWas.message}</span>
							{/if}
						</p>
						<Button
							variant="ghost"
							class="ms-auto h-9 shrink-0 rounded-full"
							onclick={() => (showingHistory = true)}
						>
							History
						</Button>
						<Button variant="outline" class="h-9 shrink-0 rounded-full" onclick={backToNow}>
							Your graph now
						</Button>
						{#if walkingNow}
							{@render walk()}
						{/if}
					</div>
				{:else if foreign}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<p class="w-full min-w-0 truncate text-sm sm:w-auto sm:flex-1">
							{#if foreign.root_address !== undefined}
								<span class="address">{foreign.root_address}</span>
							{/if}
							<span>{nameOr(regionAuthor)}</span>
							{#if foreign.graph_title}
								<span class="text-muted-foreground">· {foreign.graph_title}</span>
							{/if}
							<span class="text-muted-foreground">· {summary}</span>
						</p>
						<Button
							variant="outline"
							class="ms-auto h-9 shrink-0 rounded-full"
							onclick={leaveRegion}
						>
							Your graph
						</Button>
						{#if walkingNow}
							{@render walk()}
						{/if}
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<!-- The graph you are in leads the chrome, because everything the
						     row after it does happens inside that one. -->
						<button
							type="button"
							aria-label="Your graphs"
							onclick={() => (switching = true)}
							class="-mx-2 flex min-h-9 w-full min-w-0 items-baseline gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto sm:flex-1"
						>
							<span class="min-w-0 shrink truncate font-medium">{graphName}</span>
							{#if besideIt}
								<span class="shrink-0 text-xs text-muted-foreground">{besideIt}</span>
							{/if}
							<!-- Nothing of its own to start from, so the graph is named whole
							     before the census beside it gets a pixel. -->
							<span class="min-w-0 flex-1 truncate text-muted-foreground">· {summary}</span>
						</button>
						<button
							type="button"
							aria-label="Find a note ({FIND_NOTE.says})"
							aria-keyshortcuts={FIND_NOTE.keys}
							onclick={() => (finding = true)}
							class="flex h-9 min-w-0 shrink-0 items-center justify-center gap-2 rounded-full border border-input px-2.5 text-left text-sm text-muted-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-56 sm:justify-start sm:px-3"
						>
							<Search class="size-4 shrink-0" />
							<span class="hidden min-w-0 truncate sm:inline">Find a note</span>
						</button>
						<div class="ms-auto flex shrink-0 items-center">
							<Button
								class="h-9 rounded-s-full rounded-e-none pe-3"
								disabled={creating}
								aria-label="New branch ({NEW_BRANCH.says})"
								aria-keyshortcuts={NEW_BRANCH.keys}
								onclick={() => writeBranch(null)}
							>
								<Plus class="size-4" />
								New branch
							</Button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											class="h-9 rounded-s-none rounded-e-full border-s border-primary-foreground/25 px-2"
											disabled={creating}
											aria-label="Other ways to write"
										>
											<ChevronDown class="size-4" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="w-60">
									<DropdownMenu.Item class="min-h-11 gap-2" onSelect={writeAlone}>
										<FilePlus class="size-4 text-muted-foreground" />
										A note on its own
									</DropdownMenu.Item>
									<DropdownMenu.Item class="min-h-11 gap-2" onSelect={startNumbering}>
										<Hash class="size-4 text-muted-foreground" />
										Number it yourself
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon"
										class="size-9 shrink-0 rounded-full"
										aria-label="More"
									>
										<Ellipsis class="size-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-56">
								{#if !session.onDevice}
									<DropdownMenu.Item class="min-h-11 gap-2" onSelect={visitPeers}>
										<Users class="size-4 text-muted-foreground" />
										Other people's graphs
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item class="min-h-11 gap-2" onSelect={startChoosing}>
									<ListChecks class="size-4 text-muted-foreground" />
									Choose notes
								</DropdownMenu.Item>
								{#if graphHistory.keeps}
									<DropdownMenu.Item
										class="min-h-11 gap-2"
										onSelect={() => (showingHistory = true)}
									>
										<HistoryIcon class="size-4 text-muted-foreground" />
										History
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item class="min-h-11 gap-2" onSelect={() => void takeArchive()}>
									<Download class="size-4 text-muted-foreground" />
									Export this graph
								</DropdownMenu.Item>
								<DropdownMenu.Item class="min-h-11 gap-2" onSelect={() => chooser?.click()}>
									<Upload class="size-4 text-muted-foreground" />
									Import a graph
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						{#if walkingNow}
							{@render walk()}
						{/if}
					</div>
				{/if}

				{#if railTags.length > 0 || selection.length > 0}
					<TagRail tags={railTags} selected={selection} onselect={(next) => tags.select(next)} />
				{/if}

				{#if comparing}
					<DifferenceLegend />
				{/if}

				{#if asLastRead}
					<div class="flex items-center gap-2">
						<p class="min-w-0 text-sm text-muted-foreground" role="status">
							This is your graph as you last read it.
						</p>
						<Button variant="ghost" class="h-9 shrink-0 rounded-full text-sm" onclick={loadGraph}>
							Try again
						</Button>
					</div>
				{/if}

				{#if shortField}
					<p class="text-sm text-destructive" role="alert">{shortField}</p>
				{/if}

				{#if taking}
					<p class="text-sm text-muted-foreground" role="status">Putting this graph together…</p>
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
			onPublish={session.onDevice ? undefined : openPublish}
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
	suggestions={railTags}
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

<ChosenPublish
	bind:open={publishing}
	count={acted.length}
	{alreadyOut}
	{keepsTerms}
	carriedBy={carriedAbove}
	narrower={narrowerUnderChosen}
	answersReach={identity.kind !== 'local'}
	refused={publishRefusal}
	onpublish={() => actOnThem({ act: 'publish' })}
/>

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
		writeBranch(shape);
	}}
/>

<FindSheet
	bind:open={finding}
	query={find.query}
	found={foundNotes}
	looking={find.looking}
	settled={find.settled}
	elsewhere={graphs.all.length > onCanvas.length}
	unreadable={find.unreadable}
	exact={find.exact}
	onquery={(words) => find.type(words)}
	onopen={openFound}
/>

<HistorySurface
	bind:open={showingHistory}
	onShowVersion={(version) => {
		stopActing();
		comparing = null;
		asWas = version;
	}}
	onShowDifference={(shown) => {
		stopActing();
		asWas = shown?.later ?? null;
		comparing =
			shown === null || !comparingStates(shown.difference)
				? null
				: { says: shown.says, difference: shown.difference };
	}}
/>

<GraphsSheet
	bind:open={switching}
	graphs={graphs.all}
	current={graphs.current}
	home={graphs.home}
	alsoUp={new Set(onCanvas.slice(1))}
	full={graphs.canvasFull}
	busy={graphs.state.loading}
	says={graphs.state.failed
		? (graphs.state.error ?? null)
		: deleted.state.failed
			? (deleted.state.error ?? 'What you deleted could not be listed.')
			: null}
	deleted={deleted.all.map((branch) => ({
		ref: branch.ref,
		address: branch.address,
		graph: branch.graph,
		title: branch.title,
		notes: branch.notes,
		within: timeToPutBack(branch.deleted_at)
	}))}
	publishedFrom={publications.state.loaded
		? new Set(publications.all.map((one) => one.graph ?? graphs.home))
		: undefined}
	onShow={() => void deleted.reload().catch(() => {})}
	onRestore={(ref) =>
		inTheirWords(async () => {
			const back = await deleted.restore(ref);
			const graph = graphOf(back);
			await Promise.all([nodes.reload({ graph }), nodes.reload({ origin: back.origin })]);
			void tags.reload(graph).catch(() => {});
			void deleted.reload().catch(() => {});
		}, 'That branch could not be put back.')}
	onEnter={(ref) => {
		graphs.enter(ref);
		closeUndrawn();
	}}
	onToggle={(ref) => {
		graphs.toggleOnCanvas(ref);
		closeUndrawn();
	}}
	onOpen={(title) => inTheirWords(() => graphs.open({ title }), 'That graph could not be started.')}
	onRename={(ref, title) =>
		inTheirWords(() => graphs.rename(ref, { title }), 'That name could not be saved.')}
	onOwnership={(ref, ownership) =>
		inTheirWords(
			() => graphs.setOwnership(ref, ownership),
			'That could not be saved. Try again in a moment.'
		)}
	onRemove={(ref) =>
		inTheirWords(async () => {
			await graphs.close(ref);
			closeUndrawn();
			void deleted.reload().catch(() => {});
		}, 'That graph could not be closed.')}
/>

<input
	bind:this={chooser}
	type="file"
	accept=".sloppy"
	class="hidden"
	onchange={(event) => {
		const input = event.currentTarget;
		void readArchive(input.files?.[0]);
		input.value = '';
	}}
/>

<ImportSheet
	open={arriving !== null}
	onOpenChange={(up) => {
		if (!up) arriving = null;
	}}
	preview={arriving?.preview ?? null}
	yours={arriving?.preview ? arriving.preview.owner === session.viewer?.did : true}
	reading={arriving?.reading ?? false}
	busy={arriving?.busy ?? false}
	refused={arriving?.refused ?? null}
	onimport={(settle) => void bringItIn(settle)}
	oncancel={() => (arriving = null)}
/>

<WallpaperSheet
	bind:open={choosingWallpaper}
	media={wallpaperMedia}
	choice={wallpaper ?? openingWallpaper()}
	onchange={(next) => prefs.setWallpaper(graph, next.pictures.length === 0 ? null : next)}
/>

<PeersSheet
	bind:open={visiting}
	regions={heldRegions}
	following={followedPeople}
	answers={answeredNotes}
	{asking}
	busy={peers.busy}
	says={peers.says}
	onEnter={(ref) => void enterRegion(ref)}
	onDrop={(ref) => {
		if (foreign?.ref === ref) leaveRegion();
		void peers.drop(ref);
	}}
	onLook={async (typed, where, cursor) => {
		const who = await peers.identify(typed, where);
		if (who === null) return null;
		const page = await peers.publishedBy(who, { sourceUrl: where, cursor });
		return page && { identity: who, publications: page.publications, nextCursor: page.next_cursor };
	}}
	onChain={(region) => peers.readChain(region.publication, region.from)}
	onChanges={async (region, to, cursor) => {
		const page = await peers.changesBetween(region.publication, region.version.ref, to.ref, {
			sourceUrl: region.from,
			...(cursor === undefined ? {} : { cursor })
		});
		return page && { changes: page.changes, nextCursor: page.nextCursor };
	}}
	onRefresh={(region) =>
		void peers.pull({ publication: region.publication, sourceUrl: region.from })}
	onPull={async (where, publication) => {
		const region = await peers.pull({ publication, sourceUrl: where });
		if (!region) return;
		visiting = false;
		await enterRegion(region.ref);
	}}
	onFollow={(who) => void peers.follow(who)}
	onUnfollow={(who) => void peers.unfollow(who)}
	onOpenAnswer={(note) => {
		leaveRegion();
		void reachCited(note);
		show(note);
	}}
	onRetry={peers.loaded ? undefined : () => void peers.load()}
/>

{#if foreign}
	<HeldNote
		note={reachedNote}
		author={{ identity: authorOf(foreign), person: regionAuthor }}
		notebook={foreign.graph_title}
		link={reached ? citationUrl(reached) : undefined}
		blocks={reached ? peers.stack(reached) : []}
		loading={reaching !== null && reaching === reached}
		says={reachRefused}
		writingRefused={citeRefused}
		pictures={heldPictures}
		references={heldReferences}
		emoji={heldEmoji}
		conversation={heldConversation}
		onCite={(note) => void writeCiting(note.ref)}
		onClose={closeHeld}
	/>
{/if}

<PersonSurface bind:did={meeting} />

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

<!-- One author's graph at a time, so the reader's own notes are not read beside
     somebody else's region — a history pop is the way in that nothing else
     closes. -->
<ReadingPanel
	open={(writingNow !== null || (open !== null && !walkingNow)) && !foreign && !notNow}
	onOpenChange={(v) => {
		if (!v) hide();
	}}
	title={readingName}
	{tabs}
	active={markedTab}
	says={tooMany}
	width={prefs.current.readingWidth}
	onWidthChange={(px) => prefs.set('readingWidth', px)}
	onActivate={activate}
	onCloseTab={closeTab}
>
	{#if writingNow}
		<Writing
			title={writingNow.title}
			body={writingNow.body}
			numbering={writingNow.numbering}
			refused={writingNow.refused}
			onTitle={(said) => {
				if (writing) writing.title = said;
			}}
			onBody={(said) => {
				if (writing) writing.body = said;
			}}
			onCaret={(where) => {
				if (writing) writing.where = where;
			}}
			onAgain={writeAgain}
			onClose={hide}
		/>
	{:else if open}
		<Note
			ref={open}
			{naming}
			{seed}
			{typed}
			writingAnother={creating}
			{openNotes}
			onAsking={(up) => (noteAsking = up)}
			onSeeded={() => (seed = null)}
			onTyped={() => (typed = null)}
			onWrite={(want) =>
				startWriting({ from: { relation: want.relation, note: want.from } }, want.from, want.shape)}
			onOpen={show}
			onOpenAlso={showAlso}
			onLinkOnGraph={() => pointFrom(open)}
			onDeleted={(of, above) => closeGone([of], above)}
			onBack={wayBack === null ? null : walkBack}
			onClose={hide}
		/>
	{/if}
</ReadingPanel>
