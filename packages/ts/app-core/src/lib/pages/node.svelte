<script lang="ts">
	// One note's interior, on the reading surface `ReadingPanel` gives it. The
	// address rides the top because it is what a person cites and a peer resolves.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Copy from '@lucide/svelte/icons/copy';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Files from '@lucide/svelte/icons/files';
	import Globe from '@lucide/svelte/icons/globe';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Move from '@lucide/svelte/icons/move';
	import Share2 from '@lucide/svelte/icons/share-2';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import {
		alongRun,
		BlockViewSchema,
		citedNotes,
		compareOrd,
		graphOf,
		isAddress,
		isInSubtree,
		nextChildAddress,
		noteLabel,
		parentAddress,
		runKeyOf,
		type Address,
		type BlockDocument,
		type BlockView,
		type CommentAccess,
		type CreateBlockRequest,
		type NodeAppearance,
		type NodeView,
		type OwnedRef,
		type PullView,
		type StoreRef,
		type Tag as TagName,
		type UnpublishedChanges,
		type UpdateBlockRequest
	} from '@sloppy/types';
	import {
		BlockStack,
		ConfirmModal,
		Conversation,
		LookControls,
		MoveSheet,
		nameOf,
		namedBranch,
		namedBranches,
		NoteMenu,
		PublishModal,
		ResponsiveModal,
		scrollFade,
		suggestedFor,
		TagField,
		TemplatePicker,
		textDocument,
		writeTemplate,
		type MoveTarget,
		type NoteMenuItem,
		type NoteReferences,
		type NoteTemplate,
		type ReactionPick
	} from '@sloppy/ui';
	import { Badge } from '@sloppy/ui/badge';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import * as Tabs from '@sloppy/ui/tabs';
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import NoteAuthor from '../components/note-author.svelte';
	import PersonSurface from '../components/person-surface.svelte';
	import { api } from '../api.js';
	import { deletionCost } from '../deletion.js';
	import { deviceStore, type DeviceArea } from '../device-store.js';
	import { carries, movedFrom, reachEveryGraph, type Reach } from '../note-find.js';
	import { noteEmoji, noteMedia, saveFailure } from '../note-surface.js';
	import { conversation } from '../stores/conversation.svelte.js';
	import { drafts } from '../stores/drafts.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { identity } from '../stores/identity.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { peers } from '../stores/peers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { publications, type VersionChanges } from '../stores/publications.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import { citationUrl } from './routes.js';
	import { WRITE_UNDER } from './shortcuts.js';
	import { session } from '../stores/session.svelte.js';
	import { tags } from '../stores/tags.svelte.js';

	let {
		ref,
		naming = null,
		seed = null,
		typed = null,
		writingAnother = false,
		openNotes = [],
		onAsking,
		onSeeded,
		onTyped,
		onWrite,
		onOpen,
		onOpenAlso,
		onLinkOnGraph,
		onDeleted,
		onBack = null,
		onClose
	}: {
		ref: OwnedRef;
		/** The note just written, whose title is still to be given, if it is this one. */
		naming?: OwnedRef | null;
		/** The shape the note just written was to start from, if it is this one. It
		 *  is seeded here so sections that will not write cannot strand the note. */
		seed?: { ref: OwnedRef; shape: NoteTemplate } | null;
		/** Called the moment the shape is taken up, and it must not be offered
		 *  again: a note reopened still carrying one would seed itself twice. */
		onSeeded?: () => void;
		/** What was written into this note on the surface it was written from,
		 *  before it had an address to be written into. It is put down here, and
		 *  the caret carries on where `where` says it was left. */
		typed?: { ref: OwnedRef; title: string; body: string; where: 'title' | 'body' } | null;
		/** Called once that writing has been taken up, for the same reason
		 *  {@link onSeeded} is. */
		onTyped?: () => void;
		/** Write the note that springs from this one. The surface for it opens on
		 *  the asking, which is whatever is showing this note. */
		onWrite: (want: {
			relation: 'under' | 'after';
			from: OwnedRef;
			shape: NoteTemplate | null;
		}) => void;
		/** Whether a note already asked for is still being given its address. One
		 *  is written at a time, so the controls that would ask for another wait
		 *  for it rather than taking a tap they cannot act on. */
		writingAnother?: boolean;
		/** Every note open on the reading surface, this one included. */
		openNotes?: readonly OwnedRef[];
		/** Called with whether this note has a question of its own in front of the
		 *  reader, so whatever the note sits on can leave their answer alone. */
		onAsking?: (asking: boolean) => void;
		onOpen: (ref: OwnedRef) => void;
		/** Open a note beside this one rather than in its place. Absent leaves
		 *  every row here a plain way to the note it names. */
		onOpenAlso?: (ref: OwnedRef) => void;
		/** Hand the choice of what to link to over to the graph. */
		onLinkOnGraph: () => void;
		/** This note is gone, and the branch under it with it. `above` is the note
		 *  it grew out of, for the tab it stood in. */
		onDeleted: (ref: OwnedRef, above: OwnedRef | null) => void;
		/** Back to the note the reader came here from. Absent is the head of the
		 *  trail, where the one way out is the graph. */
		onBack?: (() => void) | null;
		onClose: () => void;
	} = $props();

	const node = $derived(nodes.get(ref));
	const children = $derived(nodes.children(ref));
	const parent = $derived(node?.parent ? nodes.get(node.parent) : undefined);
	const emoji = $derived(noteEmoji(session.viewer?.did ?? ''));

	/** The notes this one is alongside, grouped the way the canvas groups them
	 *  for the run it draws: what sprang from the same note, or the branches of
	 *  one graph. */
	const alongside = $derived.by(() => {
		if (!node) return [];
		if (node.parent) return nodes.children(node.parent);
		const run = runKeyOf(node);
		return nodes.region().filter((root) => runKeyOf(root) === run);
	});

	const along = $derived(node ? alongRun(node.ref, alongside) : { before: null, after: null });

	/** Every way out of this note, in the shape the graph is drawn in. A way with
	 *  nowhere to go keeps its place and stops answering, so a walk presses the
	 *  same button in the same spot the whole way along. */
	const ways = $derived([
		{ icon: ChevronUp, says: 'The note this one grew out of', to: parent ?? null },
		{ icon: ChevronLeft, says: 'The note before this', to: along.before },
		{ icon: ChevronRight, says: 'The note after this', to: along.after },
		{ icon: ChevronDown, says: 'The first note under this', to: children[0] ?? null }
	]);

	/** Stacks already read, oldest first: a note whose sections are in hand must
	 *  not blank itself while the server says them again. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders off this, and the effect that reads it also writes it: a tracked read would re-open the note on every write.
	const read = new Map<OwnedRef, BlockView[]>();
	/** Reads in the air for a note nobody has opened yet. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- as above.
	const reading = new Set<OwnedRef>();

	/** The stack on screen and the note it is for. Named so the next note draws
	 *  from memory in the frame it opens in, not a frame later. */
	let shown = $state<{ of: OwnedRef; stack: BlockView[] } | null>(null);
	/** The note a read would not answer for, and what to tell whoever opened it. */
	let unread = $state<{ of: OwnedRef; says: string } | null>(null);
	const blocks = $derived(shown?.of === ref ? shown.stack : (read.get(ref) ?? []));
	const unreachable = $derived(unread?.of === ref ? unread.says : null);
	const loading = $derived(shown?.of !== ref && !unreachable && read.get(ref) === undefined);
	/** What an act would not do, per note and per act. It is the note's, not the
	 *  surface's: the server answers long after a finger has moved to another tab,
	 *  and an answer shown against the wrong note is a lie about that note. */
	interface Refusals {
		title?: string;
		shape?: string;
		writing?: string;
		link?: string;
		unlink?: string;
		tag?: string;
		look?: string;
		move?: string;
		publish?: string;
		remove?: string;
		copy?: string;
		address?: string;
	}
	const refusals = new SvelteMap<OwnedRef, Refusals>();
	const refused = $derived<Refusals>(refusals.get(ref) ?? {});

	function refuse(of: OwnedRef, act: keyof Refusals, says: string | null): void {
		const held = { ...(refusals.get(of) ?? {}) };
		if (says === null) delete held[act];
		else held[act] = says;
		refusals.set(of, held);
	}

	// These answer an act, not something left half-done on screen the way a title
	// is — `titles` keeps that beside it — and the fields they annotate are built
	// from the server again on the way in, so at a note the reader comes back to
	// all they can do is contradict what is on screen.
	$effect(() => {
		const of = ref;
		untrack(() => {
			for (const act of [
				'remove',
				'tag',
				'look',
				'link',
				'move',
				'publish',
				'copy',
				'address'
			] as const) {
				if (refusals.get(of)?.[act] !== undefined) refuse(of, act, null);
			}
		});
		// Cleared on the way out rather than the way in: this one is about what the
		// note now holds, not about an act the reader asked for.
		return () => {
			if (refusals.get(of)?.writing !== undefined) refuse(of, 'writing', null);
			if (untrack(() => moved)?.of === of) moved = null;
		};
	});

	/** Acts in the air, by the note they were asked in, so a wait in one tab does
	 *  not disable the same act in the next. */
	const relinking = new SvelteSet<OwnedRef>();
	const relocating = new SvelteSet<OwnedRef>();
	const seeding = new SvelteSet<OwnedRef>();

	let titleField = $state<HTMLTextAreaElement | null>(null);
	let noteBody = $state<HTMLElement | null>(null);
	let bodyStack = $state<{
		focusBody: (at?: 'start' | 'end') => void;
		carry: (text: string) => void;
	} | null>(null);
	/** Writing this note arrived with, until the surface it goes into is up. */
	let carried = $state<{ ref: OwnedRef; body: string } | null>(null);
	/** Which field the caret was in on the surface this note was written from. */
	let caretTo = $state<'title' | 'body'>('title');
	let tagsSheet = $state<HTMLElement | null>(null);

	/** Which act the shapes are being offered for: a note under this one, the one
	 *  after it, or this note itself. */
	let shaping = $state<'under' | 'after' | 'this' | null>(null);
	/** The same act, held while the sheet animates out so its title and its row
	 *  order do not change on the way. */
	let offered = $state<'under' | 'after' | 'this'>('this');
	/** Block writes the writing surface has in the air. */
	let surfaceWrites = 0;
	/** How many writes have landed in the note on screen. An answer to a read
	 *  started before one of them says less than what is already in hand. */
	let landed = 0;
	/** Bumped when the writing surface has to be built again from `blocks`. */
	let rebuilt = $state(0);

	/** The caret is in the note's own writing — a section, or the title. The
	 *  writing surface's own bar rides the foot of the note while it is, and a
	 *  way out under the thumb of somebody mid-sentence is a way out taken by
	 *  accident. */
	let writing = $state(false);
	/** A tap on that bar takes the caret off the writing for an instant, and on
	 *  touch there is no mousedown to refuse. */
	let stopped: ReturnType<typeof setTimeout> | undefined;

	/** The surfaces the one control at the head opens, none of which is writing. */
	let acting = $state(false);
	let tagging = $state(false);
	let linking = $state(false);
	let carrying = $state(false);
	let publishing = $state(false);
	/** Whoever the reader tapped in the conversation, until they close them. */
	let meeting = $state<string | null>(null);
	let removing = $state(false);

	$effect(() => {
		onAsking?.(
			acting || tagging || linking || carrying || publishing || removing || shaping !== null
		);
		return () => onAsking?.(false);
	});

	/** Which side of the note is in front of the reader: what it says, or how it
	 *  is drawn on the graph. */
	let side = $state<'note' | 'look'>('note');

	/** Typed into the field that reaches a note by the address a person cites. */
	let cited = $state('');
	/** Typed into the field that names where this note is carried to. */
	let sought = $state('');
	/** The address this note was at before the reader moved it, until they open
	 *  another: it is what a citation written before the move still leads by. */
	let moved = $state<{ of: OwnedRef; was: Address } | null>(null);
	/** Link targets a lookup found nothing at, so their row can say so. */
	const gone = new SvelteSet<OwnedRef>();

	/** A title typed and not yet stored, kept per note so a save that fails still
	 *  has it to try again — and so a note left mid-sentence still has it when it
	 *  comes back. */
	const titles = new SvelteMap<OwnedRef, string>();
	/** Titles being stored, so a blur and a walk do not both send the same one. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders off this.
	const storing = new Set<OwnedRef>();
	const title = $derived(titles.get(ref) ?? node?.title ?? '');

	const byOrd = (a: BlockView, b: BlockView) => compareOrd(a.ord, b.ord);

	/** How many notes back a walk stays instant. */
	const REMEMBERED = 24;

	/** What this device keeps of these stacks — DESIGN.md § "Persistence". */
	function kept(): DeviceArea | null {
		const did = session.viewer?.did;
		return did ? deviceStore.area(did, 'sections') : null;
	}

	/** The notes kept, oldest first, so the device holds the same {@link
	 *  REMEMBERED} a walk does rather than every note ever opened. */
	const KEPT_ORDER = 'order';
	const stackKey = (of: OwnedRef) => `of:${of}`;

	/** One at a time: two walks landing together would each write the order they
	 *  read, and the later write would drop the earlier note. */
	let keeping: Promise<unknown> = Promise.resolve();

	function keep(of: OwnedRef, stack: BlockView[]): void {
		const held = $state.snapshot(stack) as BlockView[];
		keeping = keeping
			.then(async () => {
				const area = kept();
				if (!area) return;
				await area.set(stackKey(of), held);
				const order = ((await area.get<OwnedRef[]>(KEPT_ORDER)) ?? []).filter((one) => one !== of);
				order.push(of);
				const gone = order.splice(0, Math.max(0, order.length - REMEMBERED));
				await area.set(KEPT_ORDER, order);
				for (const one of gone) await area.delete(stackKey(one));
			})
			.catch(() => {});
	}

	/** What this device kept for `of`, or nothing where it kept none and nothing
	 *  where what it kept is no longer a stack this build can read. */
	async function keptStack(of: OwnedRef): Promise<BlockView[] | null> {
		const area = kept();
		if (!area) return null;
		const held = await area.get<unknown>(stackKey(of)).catch(() => undefined);
		if (!Array.isArray(held)) return null;
		const stack: BlockView[] = [];
		for (const row of held) {
			const block = BlockViewSchema.safeParse(row);
			if (!block.success) return null;
			stack.push(block.data);
		}
		return stack;
	}

	function remember(of: OwnedRef, stack: BlockView[]): void {
		read.delete(of);
		read.set(of, stack);
		keep(of, stack);
		for (const oldest of read.keys()) {
			if (read.size <= REMEMBERED) break;
			read.delete(oldest);
		}
	}

	/** Which note's stack a block sits in, of the stacks in hand. */
	function holderOf(block: OwnedRef): OwnedRef | null {
		if (blocks.some((held) => held.ref === block)) return ref;
		for (const [of, stack] of read) {
			if (stack.some((held) => held.ref === block)) return of;
		}
		return null;
	}

	/** Puts a write into the stack of the note it was made in, which is not
	 *  always the note on screen: a writing surface sends its last write as it is
	 *  taken down, by which time the reader has walked on. */
	function amend(of: OwnedRef, change: (stack: BlockView[]) => BlockView[]): void {
		const held = of === ref ? blocks : read.get(of);
		if (!held) return;
		const stack = change(held).sort(byOrd);
		remember(of, stack);
		if (of !== ref) return;
		shown = { of, stack };
		landed += 1;
	}

	/** Whether a stack read back says anything the one in hand does not. */
	function differs(held: readonly BlockView[], answer: readonly BlockView[]): boolean {
		if (held.length !== answer.length) return true;
		return held.some(
			(block, at) =>
				block.ref !== answer[at].ref ||
				block.ord !== answer[at].ord ||
				JSON.stringify(block.content) !== JSON.stringify(answer[at].content)
		);
	}

	async function readAhead(of: OwnedRef): Promise<void> {
		reading.add(of);
		try {
			remember(of, await api.listBlocks(of));
		} catch {
			// Nobody asked for this note yet, so nothing is owed when it will not read.
		} finally {
			reading.delete(of);
		}
	}

	/** Past one section the person has made their own shape, and offering one
	 *  would be in the way rather than in time. */
	const shapeable = $derived(blocks.length <= 1);

	const suggested = $derived(offered === 'this' ? null : suggestedFor(offered));

	/** Every note the cache holds, across every graph — a link crosses them, and
	 *  so does what points back at this note. */
	const everyNote = $derived.by(() => {
		const out: NodeView[] = [];
		const walk = (list: NodeView[]) => {
			for (const note of list) {
				out.push(note);
				walk(nodes.children(note.ref));
			}
		};
		walk(nodes.region());
		return out;
	});

	/**
	 * Every note the reader holds a copy of, by the ref its AUTHOR cites it by.
	 * PRODUCT.md § "The peer": what somebody pulled is what they answer, so a
	 * citation may point at one and a picker has to offer them.
	 */
	const heldNotes = $derived.by(() => {
		const out = new SvelteMap<OwnedRef, { note: NodeView; region: PullView }>();
		for (const region of peers.regions) {
			for (const note of peers.held(region.ref)) {
				if (!out.has(note.ref)) out.set(note.ref, { note, region });
			}
		}
		return out;
	});

	/** Everything an address here can point at: the reader's own notes and the
	 *  ones they are holding. */
	const anyNote = $derived([...everyNote, ...[...heldNotes.values()].map(({ note }) => note)]);

	$effect(() => {
		for (const { note } of heldNotes.values()) untrack(() => people.resolve(note.created_by));
	});

	/** The graph this note is read in, which is the one `[[` writes into. */
	const inGraph = $derived(node ? graphOf(node) : null);
	/** The words that graph already uses, which is where a tag put here is read. */
	const suggestions = $derived(inGraph === null ? [] : tags.of(inGraph).map((one) => one.tag));
	const here = $derived(everyNote.filter((note) => graphOf(note) === inGraph));
	/** What a note's graph is called, where that is not this one. A held note is
	 *  read in one of its author's notebooks, and one person keeps several, so
	 *  the two together are what tell one of theirs from another. */
	function graphAway(note: NodeView): string | null {
		const held = heldNotes.get(note.ref);
		if (held) {
			const author = people.of(note.created_by);
			const who = author ? nameOf(author) : null;
			const notebook = held.region.graph_title ?? null;
			if (who && notebook) return `${who} · ${notebook}`;
			return who ?? notebook ?? 'A graph you hold';
		}
		const of = graphOf(note);
		return of === inGraph ? null : graphs.titleOf(of) || 'Another graph';
	}

	/** This note's own graph, named at its head only where a note from another one
	 *  is open beside it: an address is read inside one graph. */
	const graphHere = $derived.by(() => {
		if (!node || inGraph === null) return null;
		const across = openNotes.some((of) => {
			const other = nodes.get(of) ?? heldNotes.get(of)?.note;
			return other !== undefined && graphOf(other) !== inGraph;
		});
		return across ? graphs.titleOf(inGraph) || 'Untitled' : null;
	});

	const linked = $derived(
		(node?.links ?? []).map((target) => ({
			target,
			note: nodes.get(target) ?? heldNotes.get(target)?.note
		}))
	);
	const backlinks = $derived(
		anyNote.filter((note) => note.ref !== ref && note.links.includes(ref))
	);
	/** The notes whose own writing names this one; DESIGN.md § "Edges" is why
	 *  they are never the list above. A note with none derived names nothing. */
	const namedIn = $derived(
		everyNote.filter((note) => note.ref !== ref && (note.references ?? []).includes(ref))
	);

	/** Enough to recognise the one meant, never a list to browse. */
	const MATCHES = 6;

	/** A link crosses graphs, so what a person may point at does too — this
	 *  note's own graph first, since that is where most of them are. */
	const citable = $derived.by(() => {
		const needle = cited.trim().toLowerCase();
		if (!needle) return [];
		const already = new Set(node?.links ?? []);
		const wanted = (note: NodeView) =>
			note.ref !== ref && !already.has(note.ref) && carries(note, needle);
		return [
			...here.filter(wanted),
			...anyNote.filter((note) => graphAway(note) !== null && wanted(note))
		].slice(0, MATCHES);
	});

	/** Every address a run has spent that this device holds: what the notes in it
	 *  are at, and what they were at before they were moved. */
	function spentIn(run: readonly NodeView[]): Address[] {
		return run.flatMap((note) => [
			...(note.address === undefined ? [] : [note.address]),
			...(note.aliases ?? [])
		]);
	}

	/** The address the run `target` lies in is numbered against: `null` at the top
	 *  of the graph, `undefined` where nothing numbers it. */
	function runAbove(target: NodeView): Address | null | undefined {
		if (!target.parent) return null;
		const above = nodes.get(target.parent);
		if (above) return above.address;
		return target.address === undefined ? undefined : parentAddress(target.address);
	}

	/** The earliest address this note could take carried against `target`: a run
	 *  may have spent addresses this device has not read. Either landing is absent
	 *  where the run it joins numbers nothing. */
	function landsAt(target: NodeView): { under?: Address; after?: Address } {
		const along = runAbove(target);
		const alongTarget = target.parent
			? nodes.children(target.parent)
			: here.filter((note) => !note.parent);
		return {
			...(target.address === undefined
				? {}
				: { under: nextChildAddress(target.address, spentIn(nodes.children(target.ref))) }),
			...(along === undefined ? {} : { after: nextChildAddress(along, spentIn(alongTarget)) })
		};
	}

	/** Whether `target` lies under `moving`: by the genealogy where this device
	 *  holds the chain up from it, and by the addresses where it does not. */
	function beneath(moving: NodeView, target: NodeView): boolean {
		if (
			moving.address !== undefined &&
			target.address !== undefined &&
			isInSubtree(moving.address, target.address)
		) {
			return true;
		}
		let up = target.parent;
		while (up !== undefined) {
			if (up === moving.ref) return true;
			up = nodes.get(up)?.parent;
		}
		return false;
	}

	/** What letting the moved note go on `target` would do, or why it cannot. A
	 *  number is named only where there will be one: a note with none keeps none,
	 *  and beside a note nobody numbered is still the run its parent numbers. */
	function landingOn(
		moving: NodeView,
		target: NodeView
	): { under?: Address; after?: Address } | { refused: string } {
		if (target.ref === moving.ref) return { refused: 'The note you are moving.' };
		if (beneath(moving, target)) return { refused: 'Inside the note you are moving.' };
		if (moving.address === undefined) return {};
		return landsAt(target);
	}

	/** Where this note may be carried: the notes of the graph it was written in,
	 *  since a note never changes graph. What it roots is offered and refused
	 *  rather than hidden, so somebody who types its number is told why. */
	const carriers = $derived.by(() => {
		const needle = sought.trim().toLowerCase();
		if (!node || !needle) return [];
		const moving = node;
		return here
			.filter((note) => carries(note, needle))
			.slice(0, MATCHES)
			.map<MoveTarget>((note) => ({
				ref: note.ref,
				address: note.address,
				title: note.title,
				wasAt: movedFrom(note, needle),
				lands: landingOn(moving, note)
			}));
	});

	const references: NoteReferences = {
		find: (query: string) => {
			const needle = query.toLowerCase();
			return here.filter((note) => note.ref !== ref && (!needle || carries(note, needle)));
		},
		elsewhere: (query: string) => {
			const needle = query.toLowerCase();
			return anyNote.flatMap((note) => {
				const graph = graphAway(note);
				if (graph === null || (needle && !carries(note, needle))) return [];
				return [{ note, graph }];
			});
		},
		read: async (target: OwnedRef) =>
			nodes.get(target) ?? heldNotes.get(target)?.note ?? (await nodes.fetch(target)),
		write: async (name: string, relation: 'under' | 'after') => {
			try {
				return await nodes.create({ from: { relation, note: ref }, title: name });
			} catch (error) {
				throw new Error(
					serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.',
					{ cause: error }
				);
			}
		},
		open: (target: OwnedRef) => onOpen(target)
	};

	/** Only at `whole` does this note know every note it could point at, so only
	 *  there may a surface say there is no such note. */
	let reach = $state<Reach | 'reading'>('reading');

	/**
	 * A note reaches the graphs beside it in three places — what `[[` offers,
	 * what a link may be pointed at, and what points back at this note — and all
	 * three are short of a graph left unread.
	 */
	async function lookEverywhere(): Promise<void> {
		reach = 'reading';
		reach = await reachEveryGraph();
	}

	/** The regions the reader holds, opened so their notes can be pointed at. */
	async function lookAtWhatIsHeld(): Promise<void> {
		await peers.load();
		await Promise.all(peers.regions.map((region) => peers.enter(region.ref)));
	}

	$effect(() => {
		untrack(() => {
			void lookEverywhere();
			void lookAtWhatIsHeld();
		});
	});

	const consequence = $derived(deletionCost([ref]));

	// ── Publishing this branch, and what people say back ──────────────────────

	const own = $derived(node !== undefined && node.created_by === session.viewer?.did);
	/** The publication rooted at this note, which is what an act here changes. */
	const publication = $derived(node && own ? publications.at(node) : undefined);
	/** One rooted above it that already carries this branch. */
	const carriedBy = $derived(node && own ? publications.above(node) : undefined);
	/** The branch above, by the name a person cites it by: the address its root
	 *  note carries, or what that note is titled where it carries none. Absent
	 *  for a root that names itself nothing, which no citation could reach. */
	const carriedUnder = $derived.by((): { address: Address } | { title: string } | undefined => {
		const root = carriedBy ? nodes.get(carriedBy.root) : undefined;
		const address = root?.address ?? carriedBy?.root_address;
		if (address !== undefined) return { address };
		const title = root?.title.trim();
		return title ? { title } : undefined;
	});
	const narrower = $derived(
		node && own
			? namedBranches(publications.narrowerUnder(node, publication?.comments ?? 'anyone'))
			: []
	);
	const branch = $derived.by(() => {
		if (!publication) return null;
		const earlier = publications.versionBefore(publication.ref);
		return {
			latest: publication.latest,
			versions: publications.versions(publication.ref),
			...(earlier === undefined ? {} : { earlier }),
			comments: publication.comments
		};
	});

	/**
	 * True where this branch has changed since the newest version was published.
	 * It only ever reports that one HAS: what is in hand is this note's own
	 * sections and the rows of the notes around it, so writing done in another
	 * note of the branch is not visible from here — false says nothing, and
	 * nothing is said on it.
	 */
	const changedSince = $derived.by(() => {
		if (!node?.address || !publication) return false;
		const at = node.address;
		const since = publication.latest.published_at;
		if (blocks.some((section) => section.updated_at > since)) return true;
		return nodes
			.region({ origin: node.origin })
			.some(
				(other) =>
					other.address !== undefined && isInSubtree(at, other.address) && other.updated_at > since
			);
	});

	/** What somebody has to be handed beside the address before they can read a
	 *  branch published from here. Each half is left out until it is known. */
	const readerNeeds = $derived({
		...(session.viewer ? { identity: session.viewer.did } : {}),
		...(identity.servedAt ? { where: identity.servedAt } : {})
	});

	/** What the publishing sheet says went wrong: the last act's refusal, or that
	 *  nothing could be read about this branch at all. */
	const publishRefusal = $derived(
		refused.publish ??
			(publications.state.failed && !publications.state.loaded
				? (publications.state.error ??
					'Sloppy could not check whether this branch is published. Try again in a moment.')
				: null)
	);

	/** Whether anybody may answer this note: the author's own invitation, held by
	 *  an identity kept somewhere that carries a conversation at all. This surface
	 *  draws no graph but the reader's own, so their own invitation is the only
	 *  one it can be reading. */
	const answerable = $derived(
		node !== undefined && own && publications.answersOn(node) === 'anyone' && identity.converses
	);
	const conversing = $derived(conversation.status(ref));

	const conversationPeople = {
		of: (did: string) => people.of(did),
		unplaced: (did: string) => people.unplaced(did),
		resolve: (did: string) => people.resolve(did)
	};

	/** What a person says to cite this note: the address, under the name of the
	 *  notebook it is read in, since an address means one thing inside one. */
	const citation = $derived.by(() => {
		if (!node?.address) return '';
		const notebook = inGraph ? graphs.titleOf(inGraph) : '';
		return notebook ? `${node.address} · ${notebook}` : node.address;
	});

	/** A word that an act landed, gone again on its own. */
	let said = $state<string | null>(null);
	let saying: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(saying));

	function acknowledge(words: string): void {
		said = words;
		clearTimeout(saying);
		saying = setTimeout(() => (said = null), 2000);
	}

	/** The note whose address the reader is writing, until they save it or leave
	 *  it. Held per note, so walking away from a half-typed one puts the field
	 *  away rather than carrying it to the next note. */
	let addressing = $state<OwnedRef | null>(null);
	let addressTyped = $state('');
	let addressField = $state<HTMLInputElement | null>(null);
	let writingAddress = $state(false);
	const addressingHere = $derived(addressing === ref);

	function startAddressing(): void {
		addressing = ref;
		addressTyped = node?.address ?? '';
		refuse(ref, 'address', null);
	}

	function stopAddressing(): void {
		refuse(ref, 'address', null);
		addressing = null;
	}

	$effect(() => {
		if (!addressingHere) return;
		addressField?.focus();
		addressField?.select();
	});

	/** `null` takes the address off. Nothing else in the graph moves — an address
	 *  is one note's own label. */
	async function writeAddress(taking: string | null): Promise<void> {
		const of = ref;
		if (taking !== null && !isAddress(taking)) {
			refuse(of, 'address', 'Number a note like 1a1: a number first, then letters and numbers.');
			return;
		}
		writingAddress = true;
		refuse(of, 'address', null);
		try {
			await nodes.setAddress(of, taking);
			if (addressing === of) addressing = null;
			acknowledge(taking === null ? 'Address taken off.' : `This note is ${taking}.`);
		} catch (error) {
			refuse(
				of,
				'address',
				serverMessage(error) ?? 'Sloppy could not write that address. Try again in a moment.'
			);
		} finally {
			writingAddress = false;
		}
	}

	async function handOver(text: string, landed: string): Promise<void> {
		const of = ref;
		try {
			await navigator.clipboard.writeText(text);
			refuse(of, 'copy', null);
			acknowledge(landed);
		} catch {
			refuse(of, 'copy', 'Sloppy could not copy that.');
		}
	}

	const shareable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	async function share(): Promise<void> {
		const url = citationUrl(ref);
		try {
			await navigator.share({ url, ...(node?.title ? { title: node.title } : {}) });
		} catch (error) {
			// Backing out of the sheet is not a failure, and leaves nothing to say.
			if (error instanceof DOMException && error.name === 'AbortError') return;
			await handOver(url, 'Link copied.');
		}
	}

	/** What a reader DOES to a note, as against what they read off it. Delete
	 *  comes last and apart — DESIGN.md § Layout. */
	let actsFrom = $state<HTMLElement | null>(null);
	const acts = $derived<NoteMenuItem[]>([
		// One note is written at a time, so while one is being given its address
		// these are not offered at all rather than offered and unable to answer.
		...(writingAnother
			? []
			: [
					{
						label: 'Write a note under this',
						icon: CornerDownRight,
						onSelect: () => write('under', null)
					},
					{ label: 'Write the next note', icon: ArrowRight, onSelect: () => write('after', null) }
				]),
		...(own ? [{ label: 'Move this note', icon: Move, onSelect: () => (carrying = true) }] : []),
		{ label: 'Tags', icon: Tag, onSelect: () => (tagging = true) },
		{ label: 'Link to another note', icon: Link2, onSelect: () => (linking = true) },
		{
			label: 'Copy link',
			icon: Copy,
			onSelect: () => void handOver(citationUrl(ref), 'Link copied.')
		},
		...(shareable ? [{ label: 'Share', icon: Share2, onSelect: () => void share() }] : []),
		...(own ? [{ label: 'Publishing', icon: Globe, onSelect: () => (publishing = true) }] : []),
		{
			label: 'Delete this note',
			icon: Trash2,
			onSelect: () => (removing = true),
			destructive: true
		}
	]);

	/** Whether this device is still holding writing for the note on screen. */
	const unsaved = $derived(drafts.waiting(ref));

	/** What an act was refused, once the surface that asked has been put away. It
	 *  rides the head with the one control every act is asked from, which a
	 *  reader reaches from anywhere in a long note — so its answers have to reach
	 *  them from there too. Gravest first. */
	const saysHere = $derived(
		(!removing && refused.remove) ||
			(!publishing && refused.publish) ||
			(!linking && refused.link) ||
			(!carrying && refused.move) ||
			(side !== 'look' && refused.look) ||
			(!tagging && refused.tag) ||
			refused.copy ||
			null
	);

	// The modal claims focus for itself one frame after it mounts, so the caret
	// can only be put in the title the frame after that.
	$effect(() => {
		const field = titleField;
		if (naming !== ref || !field || caretTo === 'body') return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				field.focus();
				field.setSelectionRange(field.value.length, field.value.length);
			});
		});
		return () => cancelAnimationFrame(frame);
	});

	// The writing surface is built after the note has been read, so writing the
	// note arrived with waits for the surface rather than the other way round.
	$effect(() => {
		const stack = bodyStack;
		const said = carried;
		if (!stack || !said || said.ref !== ref) return;
		carried = null;
		const to = caretTo;
		void tick().then(() => {
			stack.carry(said.body);
			if (to === 'body') stack.focusBody('end');
		});
	});

	// Left to itself the sheet takes the first thing it can focus, which in a
	// field of tags is a chip's Remove: one keystroke from dropping a tag on a
	// surface opened to add one.
	$effect(() => {
		const sheet = tagsSheet;
		if (!tagging || !sheet) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => sheet.querySelector<HTMLInputElement>('input')?.focus());
		});
		return () => cancelAnimationFrame(frame);
	});

	// A link may point at a note that has since gone, and a row that waits on one
	// forever is worse than a row that says so.
	$effect(() => {
		for (const { target, note } of linked) {
			if (note || gone.has(target)) continue;
			void nodes
				.fetch(target)
				.then((resolved) => {
					if (!resolved) gone.add(target);
				})
				// A lookup that failed says nothing about whether the note is there.
				.catch(() => {});
		}
	});

	/** How far down each note the reader had got, so a note switched away from and
	 *  come back to opens where they left it rather than at its top. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders off this.
	const places = new Map<OwnedRef, number>();

	/** The note scrolls inside a surface it does not own, so where it is scrolled
	 *  to is whatever that surface turns out to be. */
	function scrollBox(): HTMLElement | null {
		for (let box = noteBody?.parentElement; box; box = box.parentElement) {
			const flow = getComputedStyle(box).overflowY;
			if (flow === 'auto' || flow === 'scroll') return box;
		}
		return null;
	}

	function keepPlace(of: OwnedRef): void {
		const box = scrollBox();
		if (box) places.set(of, box.scrollTop);
	}

	function startAtTheirPlace(of: OwnedRef): void {
		const box = scrollBox();
		if (box) box.scrollTop = places.get(of) ?? 0;
	}

	/** A title wraps rather than scrolling out of sight, so the box follows it. */
	function fitTitle(field: HTMLTextAreaElement): void {
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	$effect(() => {
		if (node && titleField) fitTitle(titleField);
	});

	// Dismissing the sheet with the keyboard tears the field down without ever
	// blurring it, and what was typed into any of the notes worked in here is
	// still worth keeping.
	onDestroy(() => {
		clearTimeout(stopped);
		for (const of of titles.keys()) void saveTitle(of);
	});

	function caretIn(target: EventTarget | null): void {
		if (!(target instanceof Element)) return;
		if (
			target !== titleField &&
			!target.closest('[contenteditable]:not([contenteditable="false"])')
		)
			return;
		clearTimeout(stopped);
		writing = true;
	}

	function caretGone(): void {
		clearTimeout(stopped);
		stopped = setTimeout(() => (writing = false), 250);
	}

	// Read before the swap, never after: by the time a render effect runs the box
	// has been re-laid — around the next note, or around a Look side a fraction of
	// its height — and `scrollTop` comes back clamped.
	$effect.pre(() => {
		const leaving = ref;
		const reading = side === 'note';
		return () => {
			if (reading) keepPlace(leaving);
		};
	});

	// The note stays mounted behind Look but hidden, so the box is only as tall as
	// Look until the note is back on screen, and a place set any earlier is clamped
	// away.
	$effect(() => {
		const opening = side === 'note' ? ref : null;
		if (!opening) return;
		void tick().then(() => startAtTheirPlace(opening));
	});

	$effect(() => {
		const opening = ref;
		const starting = untrack(() => {
			if (seed?.ref !== opening) return null;
			const shape = seed.shape;
			onSeeded?.();
			return shape;
		});
		// A shape writes this note's sections itself, so writing that arrived with
		// the note goes down as the first of them rather than through the surface:
		// two writers on one stack is what `stackSettled` exists to keep apart.
		const arrived = untrack(() => {
			caretTo = 'title';
			carried = null;
			if (typed?.ref !== opening) return null;
			const said = typed;
			onTyped?.();
			if (said.title) titles.set(opening, said.title);
			if (starting) return said;
			caretTo = said.where;
			if (said.body || said.where === 'body') carried = { ref: opening, body: said.body };
			return said;
		});
		let live = true;
		const known = read.get(opening);
		const wrote = landed;
		cited = '';
		acting = false;
		tagging = false;
		side = 'note';
		linking = false;
		publishing = false;
		removing = false;
		unread = null;
		shaping = null;
		writing = false;
		void (async () => {
			let held = false;
			// Asked before the device is read, so reading the device never delays
			// it. The empty catch only keeps a refusal from being loose while it is
			// read; the try below is what answers for one.
			const answer = Promise.all([nodes.fetch(opening), api.listBlocks(opening)]);
			answer.catch(() => {});
			/** What is on screen when the server answers, remembered or kept. */
			let painted = known;
			if (known === undefined) {
				const before = await keptStack(opening);
				if (live && before !== null && landed === wrote && read.get(opening) === undefined) {
					remember(opening, before);
					shown = { of: opening, stack: before };
					painted = before;
				}
			}
			try {
				const [, stack] = await answer;
				// A write that landed while this was in the air says more than it does.
				if (landed === wrote) {
					// A surface built from what was remembered is holding a stack the
					// server has moved past, and its next save would put that stack
					// back over the newer one.
					const rebuild = live && painted !== undefined && differs(blocks, stack);
					remember(opening, stack);
					if (live) shown = { of: opening, stack };
					if (rebuild) rebuilt += 1;
				}
				held = true;
			} catch (error) {
				// Sections already on screen are the note; taking them away to report
				// a read behind them costs the reader more than it tells them.
				if (live && painted === undefined) {
					unread = {
						of: opening,
						says:
							serverMessage(error) ?? 'Sloppy could not read this note. Close it and open it again.'
					};
				}
			}
			if (!live || !held) return;
			// A title typed on the surface this note was written from was never in
			// the field here, so no blur here will ever save it.
			if (arrived?.title) void saveTitle(opening);
			if (starting) await shapeThisNote(starting, arrived?.body ?? '');
		})();
		// The note being left saves its title here rather than only on blur: a tab
		// switched with a finger never blurs the field.
		return () => {
			live = false;
			void saveTitle(opening);
		};
	});

	// What the person publishes decides whether this note draws as published and
	// whether anybody may answer it, so it is read before either is drawn.
	$effect(() => {
		if (session.signedIn) void publications.load().catch(() => {});
	});

	// Which publication carries this note is read off the notes it springs from,
	// and a note opened by its own link arrives on its own.
	$effect(() => {
		const tree = node?.origin;
		if (own && tree !== undefined) void nodes.load({ origin: tree }).catch(() => {});
	});

	$effect(() => {
		if (session.signedIn) void identity.load();
	});

	$effect(() => {
		const which = publication?.ref;
		if (which) void publications.loadVersions(which).catch(() => {});
	});

	$effect(() => {
		if (answerable) void conversation.load(ref);
	});

	// The notes either side are read while this one is being read, so a walk
	// along the run does not wait on the server at every step.
	$effect(() => {
		if (loading || unreachable) return;
		for (const near of [along.before, along.after]) {
			if (near && !read.has(near.ref) && !reading.has(near.ref)) void readAhead(near.ref);
		}
	});

	async function saveTitle(of: OwnedRef): Promise<void> {
		const draft = titles.get(of);
		if (draft === undefined || storing.has(of)) return;
		if (draft === nodes.get(of)?.title) return;
		storing.add(of);
		try {
			await nodes.update(of, { title: draft });
			if (titles.get(of) === draft) titles.delete(of);
			refuse(of, 'title', null);
		} catch (error) {
			refuse(
				of,
				'title',
				serverMessage(error) ?? 'Sloppy could not save that title. Try again in a moment.'
			);
		} finally {
			storing.delete(of);
		}
	}

	function write(relation: 'under' | 'after', shape: NoteTemplate | null): void {
		onWrite({ relation, from: ref, shape });
	}

	/** Two writers appending to one stack would interleave their sections, so a
	 *  shape waits until nothing the writing surface started is still in the air.
	 *  It waits a turn first, because a write started as the surface goes away is
	 *  not counted the moment it is started. */
	async function stackSettled(): Promise<void> {
		await tick();
		do {
			await new Promise((wake) => setTimeout(wake));
		} while (surfaceWrites > 0);
	}

	/** Gives this note a shape, its sections landing under what is already here.
	 *  `first` is writing the note arrived holding, which goes down before them. */
	async function shapeThisNote(shape: NoteTemplate, first = ''): Promise<void> {
		const into = ref;
		if (seeding.has(into)) return;
		seeding.add(into);
		refuse(into, 'shape', null);
		await stackSettled();

		let refusal: string | null = null;
		let unwritten = first;
		try {
			let after = read.get(into)?.at(-1)?.ref;
			if (unwritten) {
				after = (await api.createBlock({ node: into, content: textDocument(unwritten) })).ref;
				unwritten = '';
			}
			await writeTemplate(shape, { node: into, after }, api.createBlock);
		} catch (error) {
			// Back to the surface, which saves it on its own clock and keeps trying.
			if (unwritten) carried = { ref: into, body: unwritten };
			refusal =
				serverMessage(error) ?? 'Sloppy could not add those sections. Try again in a moment.';
		}
		let stack: BlockView[] | null = null;
		try {
			stack = (await api.listBlocks(into)).sort(byOrd);
			remember(into, stack);
		} catch (error) {
			refusal ??=
				serverMessage(error) ?? 'Sloppy could not read this note. Close it and open it again.';
		}
		if (stack && ref === into) shown = { of: into, stack };
		refuse(into, 'shape', refusal);
		seeding.delete(into);
	}

	function offerShapes(act: 'under' | 'after' | 'this'): void {
		offered = act;
		shaping = act;
	}

	function pickShape(shape: NoteTemplate | null): void {
		const act = shaping;
		shaping = null;
		if (act === null) return;
		if (act === 'this') {
			if (shape) void shapeThisNote(shape);
			return;
		}
		write(act, shape);
	}

	/**
	 * The note this write named, as the server has it now. A `[[` draws a line on
	 * the canvas — DESIGN.md § Edges — and the server derives that line off the
	 * writing, so a write that changed which notes are named leaves every surface
	 * reading this row out of date. Asked for only when it did.
	 */
	function reread(of: OwnedRef, before: BlockDocument | null, after: BlockDocument | null): void {
		const named = (content: BlockDocument | null) =>
			content === null ? '' : citedNotes(content).sort().join(' ');
		if (named(before) === named(after)) return;
		void nodes.refetch(of).catch(() => null);
	}

	/** What a section says now, of the stacks in hand. */
	function sectionIn(of: OwnedRef, block: OwnedRef): BlockDocument | null {
		const stack = of === ref ? blocks : (read.get(of) ?? []);
		return stack.find((held) => held.ref === block)?.content ?? null;
	}

	/** Notes whose stack is being read again, so one refusal starts one read. */
	const rereading = new SvelteSet<OwnedRef>();

	/**
	 * The note as it stands now, after a write was refused because the section
	 * had been written somewhere else. The surface is built again from it, and
	 * opens on what this device is still holding beside what came in.
	 */
	async function reopen(of: OwnedRef): Promise<void> {
		if (rereading.has(of)) return;
		rereading.add(of);
		try {
			const stack = (await api.listBlocks(of)).sort(byOrd);
			remember(of, stack);
			refuse(of, 'writing', 'This note was also written somewhere else. Both versions are here.');
			if (of !== ref) return;
			shown = { of, stack };
			rebuilt += 1;
		} catch {
			// The surface is holding the writing and says so; a read that will not
			// answer takes nothing away from it.
		} finally {
			rereading.delete(of);
		}
	}

	/** What the writing surface is told when a write does not land, which decides
	 *  whether it keeps trying and what it says. */
	function refusedWrite(of: OwnedRef, error: unknown): Error {
		const failure = saveFailure(error);
		if (failure.trouble === 'elsewhere') void reopen(of);
		return failure;
	}

	async function addBlock(request: CreateBlockRequest): Promise<BlockView> {
		surfaceWrites += 1;
		try {
			const block = await api.createBlock(request);
			amend(block.node, (stack) => [...stack, block]);
			reread(block.node, null, block.content);
			return block;
		} catch (error) {
			throw refusedWrite(request.node, error);
		} finally {
			surfaceWrites -= 1;
		}
	}

	async function editBlock(block: OwnedRef, request: UpdateBlockRequest): Promise<BlockView> {
		surfaceWrites += 1;
		const of = holderOf(block) ?? ref;
		const before = sectionIn(of, block);
		try {
			const saved = await api.updateBlock(block, request);
			amend(saved.node, (stack) => stack.map((held) => (held.ref === saved.ref ? saved : held)));
			reread(saved.node, before, saved.content);
			return saved;
		} catch (error) {
			throw refusedWrite(of, error);
		} finally {
			surfaceWrites -= 1;
		}
	}

	async function dropBlock(block: OwnedRef): Promise<void> {
		const of = holderOf(block);
		const before = of === null ? null : sectionIn(of, block);
		surfaceWrites += 1;
		try {
			await api.deleteBlock(block);
			if (of) {
				amend(of, (stack) => stack.filter((held) => held.ref !== block));
				reread(of, before, null);
			}
		} catch (error) {
			throw refusedWrite(of ?? ref, error);
		} finally {
			surfaceWrites -= 1;
		}
	}

	/** True where the links landed. Adding one and taking one off answer in
	 *  different places, so they are refused under different names. */
	async function relink(
		links: OwnedRef[],
		act: 'link' | 'unlink',
		whenItFails: string
	): Promise<boolean> {
		const of = ref;
		if (relinking.has(of)) return false;
		relinking.add(of);
		refuse(of, act, null);
		try {
			await nodes.update(of, { links });
			return true;
		} catch (error) {
			refuse(of, act, serverMessage(error) ?? whenItFails);
			return false;
		} finally {
			relinking.delete(of);
		}
	}

	async function retag(picked: TagName[]): Promise<void> {
		const of = ref;
		refuse(of, 'tag', null);
		try {
			await nodes.update(of, { tags: picked });
		} catch (error) {
			// The field puts its chips back on a rejection and shows what is refused;
			// swallowing this would leave a tag that never saved looking saved.
			refuse(
				of,
				'tag',
				serverMessage(error) ?? 'Sloppy could not save that tag. Try again in a moment.'
			);
			throw error;
		}
		// A tag exists exactly as long as a note carries one, so a word written
		// here is what puts it in the rail and in everybody else's completions.
		if (inGraph !== null) void tags.reload(inGraph).catch(() => {});
	}

	async function relook(appearance: NodeAppearance | null): Promise<void> {
		const of = ref;
		refuse(of, 'look', null);
		try {
			await nodes.update(of, { appearance });
		} catch (error) {
			// The field puts the choices back on a rejection and shows what is refused;
			// swallowing this would leave a look that never saved looking saved.
			refuse(
				of,
				'look',
				serverMessage(error) ?? 'Sloppy could not save that look. Try again in a moment.'
			);
			throw error;
		}
	}

	async function link(target: OwnedRef): Promise<boolean> {
		const before = node?.links;
		if (!before) return false;
		return await relink(
			[...before, target],
			'link',
			'Sloppy could not add that link. Try again in a moment.'
		);
	}

	/** The sheet stands until the server has answered, so a refusal reaches the
	 *  reader who asked for it instead of a surface they have already dismissed. */
	async function linkTo(target: OwnedRef): Promise<void> {
		if (!(await link(target))) return;
		linking = false;
		cited = '';
	}

	async function carryTo(to: { relation: 'under' | 'after'; note: OwnedRef }): Promise<void> {
		const of = ref;
		const was = node?.address;
		if (!was || relocating.has(of)) return;
		relocating.add(of);
		refuse(of, 'move', null);
		try {
			await nodes.move(of, to);
			moved = { of, was };
			carrying = false;
			sought = '';
		} catch (error) {
			refuse(
				of,
				'move',
				serverMessage(error) ?? 'Sloppy could not move that note. Try again in a moment.'
			);
		} finally {
			relocating.delete(of);
		}
	}

	async function unlink(target: OwnedRef): Promise<void> {
		const before = node?.links;
		if (!before) return;
		await relink(
			before.filter((other) => other !== target),
			'unlink',
			'Sloppy could not remove that link. Try again in a moment.'
		);
	}

	/** Whatever a conversation shows a person when a send fails is this, so a
	 *  server that explained itself in words for a human is what they read. */
	function refusal(error: unknown, otherwise: string): Error {
		return new Error(serverMessage(error) ?? otherwise, { cause: error });
	}

	/** Publish the branch rooted here, or send it again as it stands. Thrown on,
	 *  so the sheet stays up with the answer on it. */
	async function publishBranch(): Promise<void> {
		const of = ref;
		refuse(of, 'publish', null);
		try {
			await publications.publish(of);
			// The mark this note draws on the graph reads its own row.
			await nodes.fetch(of);
		} catch (error) {
			refuse(
				of,
				'publish',
				serverMessage(error) ?? 'Sloppy could not publish that branch. Try again in a moment.'
			);
			throw error;
		}
	}

	async function readChanges(
		from: OwnedRef,
		to: OwnedRef,
		cursor: string | undefined
	): Promise<VersionChanges | null> {
		const of = ref;
		const which = publication?.ref;
		if (!which) return null;
		refuse(of, 'publish', null);
		try {
			return await publications.changesBetween(which, from, to, cursor);
		} catch (error) {
			refuse(
				of,
				'publish',
				serverMessage(error) ?? 'Sloppy could not read what changed. Try again in a moment.'
			);
			return null;
		}
	}

	/** What this branch has done since its newest version went out. `null` says
	 *  the sheet keeps the answer it already had. */
	async function readPending(): Promise<UnpublishedChanges | null> {
		const which = publication?.ref;
		if (!which) return null;
		try {
			return await publications.unpublishedIn(which);
		} catch {
			return null;
		}
	}

	async function inviteAnswers(access: CommentAccess): Promise<void> {
		const of = ref;
		const which = publication?.ref;
		if (!which) return;
		refuse(of, 'publish', null);
		try {
			await publications.setComments(which, access);
		} catch (error) {
			refuse(
				of,
				'publish',
				serverMessage(error) ?? 'Sloppy could not save that. Try again in a moment.'
			);
			throw error;
		}
	}

	async function takeDown(): Promise<void> {
		const of = ref;
		const which = publication?.ref;
		if (!which) return;
		refuse(of, 'publish', null);
		try {
			await publications.unpublish(which);
			await nodes.fetch(of);
		} catch (error) {
			refuse(
				of,
				'publish',
				serverMessage(error) ?? 'Sloppy could not take that down. Try again in a moment.'
			);
			throw error;
		}
	}

	async function say(content: string, replyTo: StoreRef | undefined): Promise<void> {
		try {
			await conversation.say({
				node: ref,
				content,
				...(replyTo === undefined ? {} : { reply_to: replyTo })
			});
		} catch (error) {
			throw refusal(error, 'That could not be posted. Try again in a moment.');
		}
	}

	async function unsay(commentId: StoreRef): Promise<void> {
		try {
			await conversation.unsay(ref, commentId);
		} catch (error) {
			throw refusal(error, 'That could not be removed. Try again in a moment.');
		}
	}

	async function react(pick: ReactionPick): Promise<void> {
		try {
			await conversation.react({ node: ref, ...pick });
		} catch (error) {
			throw refusal(error, 'That reaction could not be added. Try again in a moment.');
		}
	}

	async function unreact(reactionId: StoreRef): Promise<void> {
		try {
			await conversation.unreact(ref, reactionId);
		} catch (error) {
			throw refusal(error, 'That reaction could not be removed. Try again in a moment.');
		}
	}

	async function deleteNote(): Promise<void> {
		const of = ref;
		const above = node?.parent ?? null;
		refuse(of, 'remove', null);
		try {
			await nodes.remove(of);
		} catch (error) {
			refuse(
				of,
				'remove',
				serverMessage(error) ?? 'Sloppy could not delete that note. Try again in a moment.'
			);
			// Thrown on: the question stays up with the answer on it, and the same
			// button tries again.
			throw error;
		}
		titles.delete(of);
		places.delete(of);
		read.delete(of);
		refusals.delete(of);
		onDeleted(of, above);
	}
</script>

{#snippet row(note: NodeView, choose: () => void, beside = false)}
	{@const away = graphAway(note)}
	<div class="flex flex-1 items-center gap-1">
		<button
			type="button"
			onclick={choose}
			aria-label={away
				? `${[note.address, note.title || 'Untitled'].filter(Boolean).join(' ')}, in ${away}`
				: undefined}
			class="flex min-h-11 min-w-0 flex-1 items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		>
			{#if note.address}
				<span class="address shrink-0 text-sm text-muted-foreground">{note.address}</span>
			{/if}
			<span class="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
			{#if away}
				<span class="max-w-28 shrink-0 truncate text-xs text-muted-foreground">{away}</span>
			{/if}
		</button>
		{#if beside && onOpenAlso && !openNotes.includes(note.ref)}
			<Button
				variant="ghost"
				size="icon"
				class="size-11 shrink-0 text-muted-foreground"
				aria-label="Open {noteLabel(note)} as well"
				onclick={() => onOpenAlso(note.ref)}
			>
				<Files class="size-4" />
			</Button>
		{/if}
	</div>
{/snippet}

<svelte:head>
	<title
		>{node ? [node.address, node.title || 'Untitled'].filter(Boolean).join(' · ') : 'Note'} · Sloppy</title
	>
</svelte:head>

<div
	bind:this={noteBody}
	class="mx-auto flex min-h-0 w-full max-w-[var(--reading-column,42rem)] flex-col gap-7 px-2 pb-1 sm:px-1"
	onfocusin={(e) => caretIn(e.target)}
	onfocusout={caretGone}
>
	<!-- The way out, the address and the acts keep their place however far the
	     note runs, and so does whatever one of those acts was refused. The way
	     out comes first so the surface opens on it rather than in the title
	     field, which on a phone would raise the keyboard over a note you came to
	     read. -->
	<header
		style="top: var(--reading-head, 0px)"
		class="sticky z-20 -mx-2 border-b border-border bg-background px-2 pt-2 pb-1 sm:-mx-1 sm:px-1"
	>
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={onBack ?? onClose}
				class="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
			>
				<ArrowLeft class="size-4" />
				{onBack ? 'Back' : 'Graph'}
			</button>

			{#if node}
				<div class="ml-auto flex min-w-0 items-center gap-2">
					{#if node.address && !addressingHere}
						<button
							type="button"
							aria-label={own
								? graphHere
									? `Edit the address ${node.address}, in ${graphHere}`
									: `Edit the address ${node.address}`
								: graphHere
									? `Copy the address ${node.address}, in ${graphHere}`
									: `Copy the address ${node.address}`}
							onclick={() => (own ? startAddressing() : void handOver(citation, 'Address copied.'))}
							class="flex min-h-11 min-w-0 items-baseline gap-2 rounded-md px-2 text-sm text-foreground/70 transition-colors duration-150 ease-out select-text hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						>
							<span class="address truncate">{node.address}</span>
							{#if graphHere}
								<span class="max-w-28 truncate text-xs text-muted-foreground">{graphHere}</span>
							{/if}
						</button>
						{#if own}
							<Button
								variant="ghost"
								size="icon"
								class="size-11 shrink-0 text-muted-foreground"
								aria-label={graphHere
									? `Copy the address ${node.address}, in ${graphHere}`
									: `Copy the address ${node.address}`}
								onclick={() => void handOver(citation, 'Address copied.')}
							>
								<Copy class="size-4" />
							</Button>
						{/if}
						{#if moved?.of === ref}
							<span class="shrink-0 text-xs text-muted-foreground">
								was <span class="address">{moved.was}</span>
							</span>
						{/if}
					{:else if own && !addressingHere}
						<button
							type="button"
							onclick={startAddressing}
							class="min-h-11 shrink-0 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						>
							Give it an address
						</button>
					{/if}
					<Button
						bind:ref={actsFrom}
						variant="ghost"
						size="icon"
						class="-mr-2 size-11 shrink-0 text-muted-foreground"
						aria-label="What to do with this note"
						onclick={() => (acting = true)}
					>
						<Ellipsis class="size-4" />
					</Button>
				</div>
			{/if}
		</div>

		{#if node && own && addressingHere}
			<form
				class="flex items-center gap-2 pt-1 pb-1"
				onsubmit={(event) => {
					event.preventDefault();
					void writeAddress(addressTyped.trim().toLowerCase() || null);
				}}
			>
				<Input
					bind:ref={addressField}
					bind:value={addressTyped}
					class="address h-11 min-w-0 flex-1"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					maxlength={64}
					aria-label="The address you cite this note by"
					placeholder="1a"
					onkeydown={(event) => {
						if (event.key !== 'Escape') return;
						event.preventDefault();
						stopAddressing();
					}}
				/>
				<Button type="submit" class="h-11 shrink-0" disabled={writingAddress}>Save</Button>
				{#if node.address}
					<Button
						type="button"
						variant="ghost"
						class="h-11 shrink-0"
						disabled={writingAddress}
						onclick={() => void writeAddress(null)}
					>
						Take it off
					</Button>
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 shrink-0"
					aria-label="Leave the address as it is"
					disabled={writingAddress}
					onclick={stopAddressing}
				>
					<X class="size-4" />
				</Button>
			</form>
			{#if refused.address}
				<p class="pb-1 text-sm text-destructive" role="alert">{refused.address}</p>
			{/if}
		{/if}
		{#if refused.writing}
			<p class="pb-1 text-sm text-destructive" role="alert">{refused.writing}</p>
		{/if}
		{#if saysHere}
			<p class="pb-1 text-sm text-destructive" role="alert">{saysHere}</p>
		{:else if unsaved}
			<p class="pb-1 text-sm text-muted-foreground">
				Not saved yet. Your writing is kept on this device.
			</p>
		{/if}
		{#if said}
			<p class="pb-1 text-sm text-muted-foreground" role="status">{said}</p>
		{/if}
	</header>

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
		<div class="space-y-3">
			<textarea
				bind:this={titleField}
				value={title}
				rows="1"
				oninput={(e) => {
					titles.set(ref, e.currentTarget.value);
					fitTitle(e.currentTarget);
				}}
				onkeydown={(e) => {
					const out = e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey);
					if (!out || e.metaKey || e.ctrlKey || e.altKey) return;
					// A title is done with when the writing starts, and on a phone the
					// keyboard has to stay up between the two.
					if (bodyStack) {
						e.preventDefault();
						bodyStack.focusBody();
					} else if (e.key === 'Enter') {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				onblur={() => saveTitle(ref)}
				placeholder="Untitled"
				maxlength="512"
				aria-label="Title"
				class="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl leading-snug font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:outline-none"
			></textarea>

			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<NoteAuthor did={node.created_by} />
				{#if own && (publication || carriedBy)}
					<button
						type="button"
						onclick={() => (publishing = true)}
						class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
					>
						<Globe class="size-3.5 shrink-0" />
						{#if publication}
							Published · version {publication.latest.sequence}
						{:else if carriedUnder && 'address' in carriedUnder}
							Published under <span class="address">{carriedUnder.address}</span>
						{:else if carriedUnder}
							Published under {carriedUnder.title}
						{:else if carriedBy}
							Published under a branch above
						{/if}
					</button>
				{/if}
			</div>

			{#if node.tags.length > 0}
				<button
					type="button"
					aria-label="Tags: {node.tags.join(', ')}"
					onclick={() => (tagging = true)}
					class="-mx-2 flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					{#each node.tags as tag (tag)}
						<Badge variant="outline" class="text-muted-foreground">{tag}</Badge>
					{/each}
				</button>
			{/if}

			{#if refused.title}
				<p class="text-sm text-destructive" role="alert">{refused.title}</p>
			{/if}
		</div>

		<Tabs.Root
			value={side}
			onValueChange={(chosen: string) => (side = chosen === 'look' ? 'look' : 'note')}
			class="gap-4"
		>
			<Tabs.List class="h-11 w-full p-1 sm:w-fit">
				<Tabs.Trigger value="note" class="px-6">Note</Tabs.Trigger>
				<Tabs.Trigger value="look" class="px-6">Look</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="note" class="flex flex-col gap-7">
				{#if loading || seeding.has(ref)}
					<Skeleton class="h-24 w-full" />
				{:else if unreachable}
					<p class="text-sm text-destructive" role="alert">{unreachable}</p>
				{:else}
					{#key rebuilt}
						<BlockStack
							bind:this={bodyStack}
							{node}
							{blocks}
							{emoji}
							{references}
							media={noteMedia}
							{drafts}
							onCreate={addBlock}
							onUpdate={editBlock}
							onRemove={dropBlock}
							onReorder={(block: OwnedRef, after: OwnedRef | null) => editBlock(block, { after })}
						/>
					{/key}
				{/if}

				{#if !loading && !unreachable && shapeable}
					<Button
						variant="ghost"
						class="-mt-4 h-11 w-fit text-muted-foreground"
						disabled={seeding.has(ref)}
						onclick={() => offerShapes('this')}
					>
						<LayoutTemplate class="size-4" />
						Add a shape
					</Button>
				{/if}

				{#if refused.shape}
					<p class="text-sm text-destructive" role="alert">{refused.shape}</p>
				{/if}

				<!-- Container query, never `sm:` — DESIGN.md § Layout: the room the acts
		     lay out in is the reading surface's, not the window's. -->
				<div class="@container space-y-3 border-t border-border pt-6">
					{#if children.length > 0}
						<h2 class="text-sm font-medium text-muted-foreground">Under this</h2>
						<ul
							class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
							{@attach scrollFade('y')}
						>
							{#each children as child (child.ref)}
								<li class="flex items-center">
									{@render row(child, () => onOpen(child.ref), true)}
								</li>
							{/each}
						</ul>
					{/if}

					<div class="flex flex-col gap-2 @md:flex-row">
						<div class="flex gap-2 @md:flex-1">
							<Button
								variant="outline"
								class="h-11 flex-1"
								disabled={writingAnother}
								aria-label="Write a note under this ({WRITE_UNDER.says})"
								aria-keyshortcuts={WRITE_UNDER.keys}
								onclick={() => write('under', null)}
							>
								<CornerDownRight class="size-4" />
								Write a note under this
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-11 shrink-0 text-muted-foreground"
								aria-label="Write a note under this, from a shape"
								disabled={writingAnother}
								onclick={() => offerShapes('under')}
							>
								<LayoutTemplate class="size-4" />
							</Button>
						</div>
						<div class="flex gap-2 @md:flex-1">
							<Button
								variant="outline"
								class="h-11 flex-1"
								disabled={writingAnother}
								onclick={() => write('after', null)}
							>
								<ArrowRight class="size-4" />
								Write the next note
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-11 shrink-0 text-muted-foreground"
								aria-label="Write the next note, from a shape"
								disabled={writingAnother}
								onclick={() => offerShapes('after')}
							>
								<LayoutTemplate class="size-4" />
							</Button>
						</div>
					</div>
				</div>

				{#if linked.length > 0 || backlinks.length > 0 || namedIn.length > 0}
					<div class="space-y-3 border-t border-border pt-6">
						{#if linked.length > 0}
							<h2 class="text-sm font-medium text-muted-foreground">Links to</h2>
							<ul
								class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
								{@attach scrollFade('y')}
							>
								{#each linked as { target, note: to } (target)}
									<li class="flex items-center gap-1">
										{#if to}
											{@render row(to, () => onOpen(target), true)}
										{:else if gone.has(target)}
											<p class="flex min-h-11 flex-1 items-center px-2 text-muted-foreground">
												A note that is no longer here.
											</p>
										{:else}
											<Skeleton class="h-9 flex-1" />
										{/if}
										<Button
											variant="ghost"
											size="icon"
											class="size-11 shrink-0 text-muted-foreground hover:text-destructive"
											aria-label={to ? `Unlink ${noteLabel(to)}` : 'Unlink'}
											disabled={relinking.has(ref)}
											onclick={() => unlink(target)}
										>
											<X class="size-4" />
										</Button>
									</li>
								{/each}
							</ul>

							{#if refused.unlink}
								<p class="text-sm text-destructive" role="alert">{refused.unlink}</p>
							{/if}
						{/if}

						{#if backlinks.length > 0}
							<h2 class="text-sm font-medium text-muted-foreground">Linked from</h2>
							<ul
								class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
								{@attach scrollFade('y')}
							>
								{#each backlinks as from (from.ref)}
									<li class="flex items-center">
										{@render row(from, () => onOpen(from.ref), true)}
									</li>
								{/each}
							</ul>
						{/if}

						{#if namedIn.length > 0}
							<h2 class="text-sm font-medium text-muted-foreground">Named in</h2>
							<ul
								class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
								{@attach scrollFade('y')}
							>
								{#each namedIn as from (from.ref)}
									<li class="flex items-center">
										{@render row(from, () => onOpen(from.ref), true)}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}

				{#if answerable}
					<Conversation
						comments={conversation.comments(ref)}
						reactions={conversation.reactions(ref)}
						mine={session.viewer?.did ?? ''}
						people={conversationPeople}
						{emoji}
						loading={conversing.loading}
						unreadable={conversing.failed
							? (conversing.error ??
								'Sloppy could not read what people said. Try again in a moment.')
							: null}
						onsay={say}
						onunsay={unsay}
						onreact={react}
						onunreact={unreact}
						onperson={(who) => (meeting = who)}
					/>
					<PersonSurface bind:did={meeting} />
				{/if}
			</Tabs.Content>

			<Tabs.Content value="look">
				{#if side === 'look'}
					<p class="pb-4 text-sm text-muted-foreground">How this note is drawn on the graph.</p>
					<LookControls
						appearance={node.appearance}
						media={noteMedia}
						onchange={relook}
						refused={refused.look ?? null}
					/>
				{/if}
			</Tabs.Content>
		</Tabs.Root>

		{#if !writing && ways.some((way) => way.to)}
			<!-- `--foot` is the OS bar and a breath above it: the bar is padded by it
			     so no target lands under the bar, and bled past the note by it so the
			     strip meets the foot of a sheet. The filler carries the strip on down
			     a surface that stands further off its own bottom edge. -->
			<nav
				aria-label="Nearby notes"
				style="--foot: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 1rem)"
				class="sticky bottom-[calc(var(--foot)*-1)] z-10 -mx-2 -mb-[var(--foot)] flex items-center gap-1 border-t border-border bg-background px-2 pt-1 pb-[var(--foot)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-background after:content-[''] sm:-mx-1 sm:px-1"
			>
				{#each ways as way (way.says)}
					{@const Way = way.icon}
					<Button
						variant="ghost"
						class="h-11 min-w-0 flex-1 gap-1.5 px-1 text-muted-foreground"
						disabled={!way.to}
						aria-label={way.to ? `${way.says}, ${noteLabel(way.to)}` : way.says}
						onclick={() => way.to && onOpen(way.to.ref)}
					>
						<Way class="size-4 shrink-0" />
						{#if way.to}<span class="truncate text-xs" class:address={!!way.to.address}
								>{noteLabel(way.to)}</span
							>{/if}
					</Button>
				{/each}
			</nav>
		{/if}

		<NoteMenu bind:open={acting} anchor={actsFrom} items={acts} />

		<!-- A word half-typed into one of these fields belongs to the note it was
		     typed into, so the fields are rebuilt with the note rather than kept. -->
		{#key ref}
			<ResponsiveModal bind:open={tagging} title="Tags" headed={false}>
				<div bind:this={tagsSheet} class="px-2 pt-2">
					<TagField
						tags={node.tags}
						{suggestions}
						onchange={retag}
						refused={refused.tag ?? null}
						placeholder={node.tags.length > 0 ? 'Add a tag' : 'Tag this note'}
					/>
				</div>
			</ResponsiveModal>

			<ResponsiveModal bind:open={linking} title="Link to another note">
				<div class="space-y-3 px-2 pt-2">
					<Button
						variant="outline"
						class="h-11 w-full"
						disabled={relinking.has(ref)}
						onclick={() => {
							linking = false;
							onLinkOnGraph();
						}}
					>
						<Link2 class="size-4" />
						Point at it on the graph
					</Button>

					<Input
						bind:value={cited}
						class="h-11"
						placeholder="Or link by title or address"
						aria-label="Link by title or address"
						autocapitalize="none"
						autocomplete="off"
						spellcheck="false"
					/>

					{#if refused.link}
						<p class="text-sm text-destructive" role="alert">{refused.link}</p>
					{/if}

					{#if cited.trim() && reach === 'short'}
						<p class="px-2 text-sm text-muted-foreground">
							Sloppy could not open all of your graphs, so a note in one of them may be missing
							here.
						</p>
						<Button variant="outline" class="h-11 w-full" onclick={() => void lookEverywhere()}>
							Look again
						</Button>
					{/if}

					{#if citable.length > 0}
						<ul
							aria-label="Notes to link to"
							class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
							{@attach scrollFade('y')}
						>
							{#each citable as note (note.ref)}
								<li>{@render row(note, () => linkTo(note.ref))}</li>
							{/each}
						</ul>
					{:else if cited.trim() && reach === 'reading'}
						<p class="px-2 text-sm text-muted-foreground">
							Still looking through your other graphs.
						</p>
					{:else if cited.trim() && reach === 'whole'}
						<p class="px-2 text-sm text-muted-foreground">Nothing here matches that.</p>
					{/if}
				</div>
			</ResponsiveModal>
			<MoveSheet
				bind:open={carrying}
				query={sought}
				found={carriers}
				settled={reach === 'whole'}
				refused={refused.move ?? null}
				busy={relocating.has(ref)}
				onquery={(words) => (sought = words)}
				onmove={(to) => void carryTo(to)}
			/>
		{/key}

		<TemplatePicker
			open={shaping !== null}
			onOpenChange={(v) => {
				if (!v) shaping = null;
			}}
			{suggested}
			existing={offered === 'this'}
			onpick={pickShape}
		/>

		{#if own}
			<PublishModal
				bind:open={publishing}
				address={node.address}
				link={citationUrl(ref)}
				reader={readerNeeds}
				published={branch}
				carriedBy={carriedBy ? namedBranch(carriedBy) : null}
				{narrower}
				{changedSince}
				answersReach={identity.kind !== 'local'}
				refused={publishRefusal}
				onchanges={readChanges}
				onpending={readPending}
				onpublish={publishBranch}
				oncomments={inviteAnswers}
				onunpublish={takeDown}
			/>
		{/if}

		<ConfirmModal
			bind:open={removing}
			title="Delete this note?"
			description={consequence}
			confirmLabel="Delete"
			refused={refused.remove ?? null}
			onconfirm={deleteNote}
		/>
	{/if}
</div>
