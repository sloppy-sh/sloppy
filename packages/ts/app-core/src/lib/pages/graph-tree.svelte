<script lang="ts">
	// The graph walked instead of drawn, for a reader going through the notes one
	// at a time and writing in them where they stand. A run belongs to the graph
	// it was written in — AI.md § "The Genealogy Is the Protocol" — so each graph
	// on the canvas is its own tree.
	import {
		graphOf,
		type BlockView,
		type CreateBlockRequest,
		type NodeView,
		type NoteDestination,
		type OwnedRef,
		type Tag,
		type UpdateBlockRequest
	} from '@sloppy/types';
	import {
		BlockStack,
		nameOf,
		TreeSurface,
		type NoteReferences,
		type TreeGroup,
		type TreeNote,
		type TreeSurfaceProps
	} from '@sloppy/ui';
	import { onDestroy } from 'svelte';
	import { api } from '../api.js';
	import { noteEmoji, noteMedia, saveFailure } from '../note-surface.js';
	import { drafts } from '../stores/drafts.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { outlineSections } from '../stores/outline-sections.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let {
		notes,
		fields,
		selection = [],
		reading = null,
		opened,
		inset,
		chosen,
		onChoose,
		onChoosing,
		onToggle,
		onOpen,
		onReached,
		writeUnder,
		writeAlone
	}: {
		/** Every note on the canvas, in any order — the tree finds its own shape. */
		notes: readonly NodeView[];
		/** The graphs on the canvas, in the order the fields sit in; absent is a
		 *  region pulled from somebody else, which is one author's alone. */
		fields: readonly { ref: OwnedRef; title: string }[] | undefined;
		selection?: readonly Tag[];
		reading?: OwnedRef | null;
		/** The branches the reader has opened; the tree draws no others. */
		opened: ReadonlySet<OwnedRef>;
		inset: { top: string; bottom: string };
		/** The notes chosen to act on; absent is a walk nobody is choosing on. */
		chosen?: ReadonlySet<OwnedRef>;
		onChoose?: (ref: OwnedRef) => void;
		onChoosing?: (on: boolean) => void;
		onToggle: (ref: OwnedRef, open: boolean) => void;
		onOpen: (ref: OwnedRef) => void;
		/** A note opened where it stands, so the graph behind the walk is at it
		 *  when the reader goes back to it. */
		onReached?: (ref: OwnedRef) => void;
		/** Writing a note under a row, from the row. Absent where these notes are
		 *  not the reader's to write under. */
		writeUnder?: TreeSurfaceProps['writeUnder'];
		/** Writing a note of its own, from the walk's own chrome. Absent where
		 *  these notes are not the reader's. */
		writeAlone?: TreeSurfaceProps['writeAlone'];
	} = $props();

	const LAST_WRITTEN = 8;
	/** How long a refusal is left up before the outline is quiet again. */
	const REFUSAL_MS = 6000;

	const byRef = $derived(new Map(notes.map((note) => [note.ref, note])));

	let written = $state<readonly { graph: OwnedRef; notes: readonly OwnedRef[] }[]>([]);

	$effect(() => {
		// A note written while the walk is open is the most recently written of
		// all, so the run is read again as the graph gains one.
		void notes.length;
		if (!fields) return;
		let live = true;
		void Promise.all(
			fields.map(async (field) => {
				const recent = await api
					.recentNotes({ graph: field.ref, limit: LAST_WRITTEN })
					.catch(() => []);
				return { graph: field.ref, notes: recent.map((note) => note.ref) };
			})
		).then((runs) => {
			if (live) written = runs;
		});
		return () => {
			live = false;
		};
	});

	/** Whoever wrote a held region, which is one author's alone. */
	const heldBy = $derived(fields ? undefined : notes[0]?.created_by);

	$effect(() => {
		if (heldBy) people.resolve(heldBy);
	});

	const heldAuthor = $derived.by((): string | undefined => {
		if (!heldBy) return undefined;
		const person = people.of(heldBy);
		return person ? nameOf(person) : heldBy;
	});

	const groups = $derived.by((): TreeGroup[] => {
		if (!fields) return [{ key: 'held', title: '', notes, author: heldAuthor }];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after; the derived IS the reactivity.
		const held = new Map<OwnedRef, NodeView[]>();
		for (const note of notes) {
			const field = graphOf(note);
			const run = held.get(field);
			if (run) run.push(note);
			else held.set(field, [note]);
		}
		// A graph the host did not name still gets a tree of its own, the way
		// `seedFields` in `@sloppy/graph` gives it a field of its own — the canvas
		// and the tree are handed the same notes and leave none of them out.
		const named = new Map(fields.map((field) => [field.ref, field.title]));
		const order = [...new Set([...named.keys(), ...held.keys()])];
		return order
			.map((of) => ({ key: of, title: named.get(of) ?? '', notes: held.get(of) ?? [] }))
			.filter((group) => group.notes.length > 0);
	});

	const lead = $derived.by((): TreeSurfaceProps['lead'] => {
		const runs = groups.flatMap((group) => {
			const last = (written.find((run) => run.graph === group.key)?.notes ?? [])
				.map((ref) => byRef.get(ref))
				.filter((note): note is NodeView => note !== undefined)
				.slice(0, LAST_WRITTEN);
			if (last.length === 0) return [];
			const title =
				groups.length > 1 ? `Last written in ${group.title || 'Untitled'}` : 'Last written';
			return [{ group: group.key, title, notes: last }];
		});
		return runs.length > 0 ? runs : undefined;
	});

	// A held region is one author's alone, so nothing in it is the reader's to
	// read here or to arrange — and the walk of it is the notes alone.
	const sections = $derived<TreeSurfaceProps['sections'] | undefined>(
		fields
			? {
					shown: outlineSections.shown,
					of: (note) => outlineSections.of(note),
					says: (note) => outlineSections.says(note),
					onShow: (note, show) => {
						outlineSections.show(note, show);
						if (show) onReached?.(note);
					},
					onMove: (note, section, after) => outlineSections.move(note, section, after),
					onCarry: {
						into: (section, note, after) => outlineSections.moveTo(section, note, after),
						onto: (section, note) => void carryOnto(section, note),
						out: (section, on, relation) => void carryOut(section, on, relation)
					}
				}
			: undefined
	);

	$effect(() => {
		outlineSections.mine(session.viewer?.did ?? null);
	});

	/** Why the note or section somebody carried did not go, gone again on its
	 *  own. */
	let refused = $state('');
	let refusing: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(refusing));

	function refuse(says: string): void {
		refused = says;
		clearTimeout(refusing);
		refusing = setTimeout(() => (refused = ''), REFUSAL_MS);
	}

	// A held region is somebody else's graph, and nothing in it is the reader's
	// to carry.
	const moveNote = $derived<TreeSurfaceProps['moveNote']>(
		fields ? { move: carry, refused } : undefined
	);

	function carry(ref: OwnedRef, to: NoteDestination): void {
		refused = '';
		clearTimeout(refusing);
		void nodes.move(ref, to).catch((error: unknown) => {
			refuse(serverMessage(error) ?? 'Sloppy could not move that note. Try again.');
		});
	}

	/** A section let go on a note whose sections are not open: it goes to the end
	 *  of that note's stack, which the note has to be read to know. */
	async function carryOnto(section: OwnedRef, note: OwnedRef): Promise<void> {
		refused = '';
		await outlineSections.read(note);
		const stack = outlineSections.of(note);
		if (!stack) {
			refuse('Sloppy could not read that note. Try again in a moment.');
			return;
		}
		outlineSections.moveTo(section, note, stack.length > 0 ? stack[stack.length - 1].ref : null);
	}

	/** A section let go between two rows: a note of its own in the run it landed
	 *  in, with that section the only thing written in it. */
	async function carryOut(
		section: OwnedRef,
		on: OwnedRef,
		relation: 'under' | 'after'
	): Promise<void> {
		refused = '';
		let made: NodeView;
		try {
			made = await nodes.create({ from: { relation, note: on } });
		} catch (error) {
			refuse(serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.');
			return;
		}
		if (relation === 'under') onToggle(on, true);
		outlineSections.show(made.ref, true);
		await outlineSections.read(made.ref);
		outlineSections.moveTo(section, made.ref, null);
	}

	/** The reader's own catalog, which is what they can put into a note. */
	const emoji = $derived(noteEmoji(session.viewer?.did ?? ''));

	/** What `[[` reaches from a note read in the outline: the notes on the canvas
	 *  beside it. A reference into one of the reader's other graphs is written
	 *  from the note's own page, which the row keeps an act away. */
	function referencesFor(from: OwnedRef): NoteReferences {
		const field = byRef.get(from);
		return {
			find: (query: string) => {
				const needle = query.toLowerCase();
				if (!field) return [];
				const graph = graphOf(field);
				return notes.filter(
					(note) =>
						note.ref !== from &&
						graphOf(note) === graph &&
						(!needle ||
							note.title.toLowerCase().includes(needle) ||
							(note.address ?? '').toLowerCase().includes(needle))
				);
			},
			elsewhere: () => [],
			read: async (target: OwnedRef) => byRef.get(target) ?? (await nodes.fetch(target)),
			write: async (title: string, relation: 'under' | 'after' | 'free') => {
				try {
					const graph = field && graphOf(field);
					return await nodes.create({
						from:
							relation === 'free'
								? { relation, ...(graph ? { graph } : {}) }
								: { relation, note: from },
						title
					});
				} catch (error) {
					throw new Error(
						serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.',
						{ cause: error }
					);
				}
			},
			open: onOpen
		};
	}

	async function addBlock(request: CreateBlockRequest): Promise<BlockView> {
		try {
			const block = await api.createBlock(request);
			void outlineSections.read(block.node);
			return block;
		} catch (error) {
			throw saveFailure(error);
		}
	}

	async function editBlock(block: OwnedRef, request: UpdateBlockRequest): Promise<BlockView> {
		try {
			const saved = await api.updateBlock(block, request);
			void outlineSections.read(saved.node);
			return saved;
		} catch (error) {
			throw saveFailure(error);
		}
	}

	async function dropBlock(block: OwnedRef, of: OwnedRef): Promise<void> {
		try {
			await api.deleteBlock(block);
			void outlineSections.read(of);
		} catch (error) {
			throw saveFailure(error);
		}
	}

	// A note reached from anywhere else — the canvas, a link inside another note,
	// an address in the URL — is one the tree has to be able to show.
	$effect(() => {
		let note = reading ? byRef.get(reading) : undefined;
		while (note?.parent) {
			onToggle(note.parent, true);
			note = byRef.get(note.parent);
		}
	});
</script>

{#snippet interior(row: TreeNote)}
	{@const note = byRef.get(row.ref)}
	{@const stack = outlineSections.stack(row.ref)}
	{#if note && stack}
		<!-- Opened again on the order the stack stands in, so a section carried by
		     its handle is where the writing shows it. -->
		{#key outlineSections.arranged(row.ref)}
			<BlockStack
				node={note}
				blocks={stack}
				arranging={false}
				{emoji}
				{drafts}
				references={referencesFor(row.ref)}
				media={noteMedia}
				onCreate={addBlock}
				onUpdate={editBlock}
				onRemove={(block: OwnedRef) => dropBlock(block, row.ref)}
				onReorder={(block: OwnedRef, after: OwnedRef | null) => editBlock(block, { after })}
			/>
		{/key}
	{/if}
{/snippet}

<TreeSurface
	{groups}
	{lead}
	{opened}
	{selection}
	{reading}
	{inset}
	{chosen}
	{onChoose}
	{onChoosing}
	{onToggle}
	{onOpen}
	{writeUnder}
	{writeAlone}
	{sections}
	interior={fields ? interior : undefined}
	{moveNote}
/>
