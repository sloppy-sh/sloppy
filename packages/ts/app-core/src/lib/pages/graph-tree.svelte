<script lang="ts">
	// The graph walked instead of drawn, for a reader going through the notes one
	// at a time. A run belongs to the graph it was written in — AI.md § "The
	// Address Is the Protocol" — so each graph on the canvas is its own tree.
	import { graphOf, type NodeView, type OwnedRef, type Tag } from '@sloppy/types';
	import { TreeSurface, type TreeGroup, type TreeSurfaceProps } from '@sloppy/ui';
	import { api } from '../api.js';

	let {
		notes,
		fields,
		selection = [],
		reading = null,
		opened,
		inset,
		onToggle,
		onOpen,
		writeUnder
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
		onToggle: (ref: OwnedRef, open: boolean) => void;
		onOpen: (ref: OwnedRef) => void;
		/** Writing a note under a row, from the row. Absent where these notes are
		 *  not the reader's to write under. */
		writeUnder?: TreeSurfaceProps['writeUnder'];
	} = $props();

	const LAST_WRITTEN = 8;

	const byRef = $derived(new Map(notes.map((note) => [note.ref, note])));

	let written = $state<readonly { graph: OwnedRef; notes: readonly OwnedRef[] }[]>([]);

	$effect(() => {
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

	const groups = $derived.by((): TreeGroup[] => {
		if (!fields) return [{ key: 'held', title: '', notes }];
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
	{onToggle}
	{onOpen}
	{writeUnder}
/>
