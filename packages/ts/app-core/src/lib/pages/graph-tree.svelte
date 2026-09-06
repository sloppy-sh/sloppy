<script lang="ts">
	// The graph walked instead of drawn, for a reader going through the notes one
	// at a time. A run belongs to the graph it was written in — AI.md § "The
	// Address Is the Protocol" — so each graph on the canvas is its own tree.
	import { graphOf, type NodeView, type OwnedRef, type Tag } from '@sloppy/types';
	import { TreeSurface, type TreeGroup, type TreeSurfaceProps } from '@sloppy/ui';

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

	const byRef = $derived(new Map(notes.map((note) => [note.ref, note])));

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

<TreeSurface {groups} {opened} {selection} {reading} {inset} {onToggle} {onOpen} {writeUnder} />
