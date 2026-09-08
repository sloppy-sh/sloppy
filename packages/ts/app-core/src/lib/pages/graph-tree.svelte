<script lang="ts">
	// The graph walked instead of drawn, for a reader going through the notes one
	// at a time. A run belongs to the graph it was written in — AI.md § "The
	// Genealogy Is the Protocol" — so each graph on the canvas is its own tree.
	import {
		graphOf,
		type NodeView,
		type NoteDestination,
		type OwnedRef,
		type Tag
	} from '@sloppy/types';
	import { nameOf, TreeSurface, type TreeGroup, type TreeSurfaceProps } from '@sloppy/ui';
	import { onDestroy } from 'svelte';
	import { api } from '../api.js';
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
	// arrange — and the walk of it is the notes and no sections.
	const sections = $derived<TreeSurfaceProps['sections'] | undefined>(
		fields
			? {
					shown: outlineSections.shown,
					of: (note) => outlineSections.of(note),
					says: (note) => outlineSections.says(note),
					onShow: (note, show) => outlineSections.show(note, show),
					onMove: (note, section, after) => outlineSections.move(note, section, after)
				}
			: undefined
	);

	$effect(() => {
		outlineSections.mine(session.viewer?.did ?? null);
	});

	/** Why the note somebody carried did not go, gone again on its own. */
	let refused = $state('');
	let refusing: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(refusing));

	// A held region is somebody else's graph, and nothing in it is the reader's
	// to carry.
	const moveNote = $derived<TreeSurfaceProps['moveNote']>(
		fields ? { move: carry, refused } : undefined
	);

	function carry(ref: OwnedRef, to: NoteDestination): void {
		refused = '';
		clearTimeout(refusing);
		void nodes.move(ref, to).catch((error: unknown) => {
			refused = serverMessage(error) ?? 'Sloppy could not move that note. Try again.';
			refusing = setTimeout(() => (refused = ''), REFUSAL_MS);
		});
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
	{moveNote}
/>
