<script lang="ts">
	// The states the graph in front of somebody has been in, and the acts that
	// add to them — docs/ARCHITECTURE.md § "The vault's history". What is on
	// screen is `HistorySheet`'s; what any of it means is the history store's.
	import type { GraphDifference, GraphNoteMoved } from '@sloppy/graph';
	import type { NoteChangedBetween } from '@sloppy/local';
	import { noteLabel, type NodeView, type OwnedRef } from '@sloppy/types';
	import {
		type ChangedNote,
		HistorySheet,
		type KeptVersion,
		type LineOfWork,
		type NoteInTwo,
		SettleNote,
		type StatePicked
	} from '@sloppy/ui';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		type DifferenceBetween,
		graphHistory,
		type NoteInTwoVersions
	} from '../stores/history.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let {
		open = $bindable(false),
		onShowVersion,
		onShowDifference
	}: {
		open?: boolean;
		/** Absent where there is no graph on screen to draw a state on. */
		onShowVersion?: (version: { commit: string; message: string; notes: NodeView[] }) => void;
		/** Two states to draw against each other, `later` being the one the canvas
		 *  holds — absent where that is the graph as it stands. */
		onShowDifference?: (
			shown: {
				says: string;
				later: { commit: string; message: string; notes: NodeView[] } | null;
				difference: GraphDifference;
			} | null
		) => void;
	} = $props();

	/** What each note left in two versions holds on either side, once read. */
	const inTwo = new SvelteMap<string, NoteInTwoVersions | null>();
	let settling = $state<string | null>(null);
	let settleOpen = $state(false);

	const versions = $derived<KeptVersion[]>(
		graphHistory.versions.map((one) => {
			const author = named(one.author);
			return {
				id: one.id,
				message: one.message,
				...(author === undefined ? {} : { author }),
				when: when(one.at),
				merged: one.parents.length > 1
			};
		})
	);

	const lines = $derived<LineOfWork[]>(
		graphHistory.lines.map((one) => ({ name: one.name, head: one.head, here: one.current }))
	);

	const changed = $derived(graphHistory.changed ? rows(graphHistory.changed.notes) : null);

	const conflicts = $derived<NoteInTwo[]>(
		graphHistory.inTwoVersions.map((path) => {
			const held = inTwo.get(path);
			const address = held ? nodes.get(held.ref)?.address : undefined;
			return {
				path,
				title: held?.title ?? '',
				isNote: held !== null && held !== undefined,
				...(address === undefined ? {} : { address })
			};
		})
	);

	const settled = $derived(settling === null ? null : (inTwo.get(settling) ?? null));

	$effect(() => {
		const unsettled = new Set(graphHistory.inTwoVersions);
		for (const path of inTwo.keys()) if (!unsettled.has(path)) inTwo.delete(path);
		for (const path of unsettled) {
			if (inTwo.has(path)) continue;
			inTwo.set(path, null);
			void graphHistory.inTwo(path).then((held) => inTwo.set(path, held));
		}
	});

	/** Whoever kept a version, where the graph has a name for them. One kept on
	 *  this device is kept under the identity it belongs to, and an identifier is
	 *  not a name to call anybody. */
	function named(author: string): string | undefined {
		return author === '' || author === session.viewer?.did ? undefined : author;
	}

	/** The day it was kept, in the reader's own language. */
	function when(at: string): string {
		const day = new Date(at);
		return Number.isNaN(day.getTime())
			? ''
			: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	}

	/** What a person calls the note a ref names. A note the graph in front of
	 *  them no longer holds still has to be spoken of, so it is named as one. */
	function called(ref: OwnedRef | undefined): string | undefined {
		if (ref === undefined) return undefined;
		const note = nodes.get(ref);
		return note ? noteLabel(note) : 'another note';
	}

	function rows(notes: readonly NoteChangedBetween[]): ChangedNote[] {
		return notes.map((note) => ({
			ref: note.ref,
			title: note.title,
			...(note.address === undefined ? {} : { address: note.address }),
			became: note.became,
			...(note.moved
				? {
						moved: {
							...(called(note.moved.from) === undefined ? {} : { from: called(note.moved.from) }),
							...(called(note.moved.to) === undefined ? {} : { to: called(note.moved.to) })
						}
					}
				: {}),
			...(note.retitled ? { retitled: { from: note.retitled.from } } : {}),
			...(note.renumbered
				? {
						renumbered: {
							...(note.renumbered.from === undefined ? {} : { from: note.renumbered.from }),
							...(note.renumbered.to === undefined ? {} : { to: note.renumbered.to })
						}
					}
				: {}),
			reordered: note.reordered,
			sections: note.sections.map((section) => ({
				ulid: section.ulid,
				...(section.before === undefined ? {} : { before: section.before }),
				...(section.after === undefined ? {} : { after: section.after })
			}))
		}));
	}

	async function showVersion(commit: string): Promise<void> {
		if (!onShowVersion) return;
		const notes = await graphHistory.notesAt(commit);
		const version = graphHistory.versions.find((one) => one.id === commit);
		open = false;
		onShowVersion({ commit, message: version?.message ?? '', notes });
	}

	async function compare(before: StatePicked, after: StatePicked): Promise<ChangedNote[] | null> {
		const held = await graphHistory.between(before.at, after.at);
		if (!held) return null;
		if (onShowDifference) {
			onShowDifference({
				says: `${before.label} to ${after.label}`,
				later:
					after.at === undefined
						? null
						: {
								commit: after.at,
								message: after.label,
								notes: await graphHistory.notesAt(after.at)
							},
				difference: drawn(held)
			});
		}
		return rows(held.notes);
	}

	/** What the canvas draws the two states as. A note that only moved is not
	 *  `changed`: the move is drawn on its lines, and its mark says nothing. */
	function drawn(held: DifferenceBetween): GraphDifference {
		const added: OwnedRef[] = [];
		const changed: OwnedRef[] = [];
		const moved: GraphNoteMoved[] = [];
		for (const note of held.notes) {
			if (note.became === 'added') added.push(note.ref);
			if (note.became !== 'kept') continue;
			if (note.moved) {
				moved.push({
					ref: note.ref,
					...(note.moved.from === undefined ? {} : { from: note.moved.from })
				});
			}
			if (note.retitled || note.renumbered || note.reordered || note.sections.length > 0) {
				changed.push(note.ref);
			}
		}
		return { added: new Set(added), removed: held.gone, moved, changed: new Set(changed) };
	}

	async function settleWhole(side: 'mine' | 'theirs'): Promise<void> {
		const path = settling;
		if (path === null) return;
		if (await graphHistory.settle(path, side)) {
			inTwo.delete(path);
			settleOpen = false;
		}
	}

	async function settleBySection(take: ReadonlySet<string>): Promise<void> {
		const note = settled;
		if (!note) return;
		if (await graphHistory.settleSections(note, take)) {
			inTwo.delete(note.path);
			settleOpen = false;
		}
	}
</script>

<HistorySheet
	bind:open
	{changed}
	anythingToKeep={graphHistory.unkept}
	{versions}
	older={graphHistory.older}
	{lines}
	{conflicts}
	taking={graphHistory.taking}
	busy={graphHistory.busy}
	says={graphHistory.says}
	onShow={() => void graphHistory.read()}
	onKeep={(message) => graphHistory.keep(message)}
	onOlder={() => void graphHistory.readOlder()}
	onStartLine={(name) => graphHistory.startLine(name)}
	onWorkOn={(name) => graphHistory.workOn(name)}
	onBringIn={(name) => graphHistory.bringIn(name)}
	onSettle={(path) => {
		settling = path;
		settleOpen = true;
	}}
	onOpenVersion={onShowVersion ? (id) => void showVersion(id) : undefined}
	onCompare={compare}
/>

{#if settling !== null}
	<SettleNote
		bind:open={settleOpen}
		title={settled ? settled.title : 'Something else your graph keeps for you'}
		address={settled ? nodes.get(settled.ref)?.address : undefined}
		line={graphHistory.taking ?? 'the other line'}
		sections={(settled?.sections ?? []).map((section) => ({
			ulid: section.ulid,
			...(section.mine ? { here: section.mine.content } : {}),
			...(section.theirs ? { there: section.theirs.content } : {})
		}))}
		busy={graphHistory.busy}
		says={graphHistory.says}
		onKeepHere={() => settleWhole('mine')}
		onTakeThere={() => settleWhole('theirs')}
		onSettleSections={settleBySection}
	/>
{/if}
