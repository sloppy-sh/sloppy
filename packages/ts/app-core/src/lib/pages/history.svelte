<script lang="ts">
	// The states the graph in front of somebody has been in, and the acts that
	// add to them — docs/ARCHITECTURE.md § "The vault's history". What is on
	// screen is `HistorySheet`'s; what any of it means is the history store's.
	import type { GraphDifference, GraphNoteMoved } from '@sloppy/graph';
	import type { NoteChangedBetween } from '@sloppy/local';
	import { noteLabel, type NodeView, type OwnedRef } from '@sloppy/types';
	import {
		type ChangedNote,
		type ChangedPictures,
		HistorySheet,
		type KeptVersion,
		type LineOfWork,
		type NoteInTwo,
		SettleNote,
		type StatePicked
	} from '@sloppy/ui';
	import { SvelteMap } from 'svelte/reactivity';
	import BranchesPanel, { type LineRow } from '../components/branches-panel.svelte';
	import CommitDetails from '../components/commit-details.svelte';
	import { drawnFrom, type DrawnVersion, keptBy, whenKept } from '../components/commit-graph.js';
	import CommitGraph from '../components/commit-graph.svelte';
	import SyncControls, { type KeptAlso } from '../components/sync-controls.svelte';
	import {
		type DifferenceBetween,
		graphHistory,
		type NoteInTwoVersions
	} from '../stores/history.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';

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

	/** What each note left in two versions holds on either side. `undefined` is
	 *  one still being read, `null` one that is not a note at all. */
	const inTwo = new SvelteMap<string, NoteInTwoVersions | null | undefined>();
	let settling = $state<string | null>(null);
	let settleOpen = $state(false);
	let showing = $state<string | null>(null);
	let showingOpen = $state(false);
	let where = $state('');

	const versions = $derived<KeptVersion[]>(
		graphHistory.versions.map((one) => {
			const author = keptBy(one.author);
			return {
				id: one.id,
				message: one.message,
				...(author === undefined ? {} : { author }),
				when: whenKept(one.at),
				merged: one.parents.length > 1
			};
		})
	);

	const lines = $derived<LineOfWork[]>(
		graphHistory.lines.map((one) => ({ name: one.name, head: one.head, here: one.current }))
	);

	const drawnVersions = $derived<DrawnVersion[]>(drawnFrom(graphHistory.picture));

	/** The lines this folder only knows about, so the picture can draw where a
	 *  line is kept rather than read it out of its name. */
	const linesElsewhere = $derived(
		graphHistory.lines.filter((one) => one.remote !== undefined).map((one) => one.name)
	);

	const lineRows = $derived<LineRow[]>(
		graphHistory.lines.map((one) => ({
			name: one.name,
			head: one.head,
			here: one.current,
			elsewhere: one.remote !== undefined,
			...(one.ahead === undefined ? {} : { ahead: one.ahead }),
			...(one.behind === undefined ? {} : { behind: one.behind })
		}))
	);

	const places = $derived<KeptAlso[]>(graphHistory.places.map((one) => ({ ...one })));

	/** The place the acts are with: the one somebody picked, and the one the
	 *  line the folder is on follows until they do. */
	const there = $derived(
		places.some((one) => one.name === where)
			? where
			: (graphHistory.followsPlace ?? places[0]?.name ?? '')
	);

	const standing = $derived(there === '' ? undefined : graphHistory.standingAt(there));

	const opened = $derived(drawnVersions.find((one) => one.id === showing) ?? null);

	/** The lines here at a version, other than the one the folder is already on. */
	const linesAt = $derived(
		opened === null
			? []
			: graphHistory.lines
					.filter((one) => one.head === opened.id && one.remote === undefined && !one.current)
					.map((one) => one.name)
	);

	const springsFrom = $derived(
		opened === null
			? []
			: opened.parents.flatMap((parent) => {
					const one = drawnVersions.find((held) => held.id === parent);
					return one ? [{ id: one.id, message: one.message }] : [];
				})
	);

	const changed = $derived(graphHistory.changed ? rows(graphHistory.changed.notes) : null);

	const conflicts = $derived<NoteInTwo[]>(
		graphHistory.inTwoVersions.map((path) => {
			const held = inTwo.get(path);
			const address = held ? nodes.get(held.ref)?.address : undefined;
			return {
				path,
				title: held?.title ?? '',
				...(held === undefined ? {} : { isNote: held !== null }),
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
			inTwo.set(path, undefined);
			void graphHistory.inTwo(path).then((held) => inTwo.set(path, held));
		}
	});

	/** Whoever kept a version, where the graph has a name for them. */
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
		const shown = await graphHistory.asItWas(commit);
		open = false;
		showingOpen = false;
		onShowVersion(shown);
	}

	/** A version set against the folder as it stands, drawn on the graph rather
	 *  than under the picture: the picture is where somebody asked from. */
	async function compareWithNow(commit: string): Promise<void> {
		const version = drawnVersions.find((one) => one.id === commit);
		showingOpen = false;
		open = false;
		await compare({ at: commit, label: version?.message || 'A version' }, { label: 'Now' });
	}

	function openVersion(commit: string): void {
		showing = commit;
		showingOpen = true;
	}

	async function compare(
		before: StatePicked,
		after: StatePicked
	): Promise<{ notes: ChangedNote[]; pictures: ChangedPictures } | null> {
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
		return { notes: rows(held.notes), pictures: held.pictures };
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
		if (await graphHistory.settle(path, side)) settleOpen = false;
	}

	async function settleBySection(take: ReadonlySet<string>): Promise<void> {
		const note = settled;
		if (!note) return;
		if (await graphHistory.settleSections(note, take)) settleOpen = false;
	}
</script>

<HistorySheet
	bind:open
	{changed}
	pictures={graphHistory.changed?.pictures}
	anythingToKeep={graphHistory.unkept}
	{versions}
	anyKept={graphHistory.draws ? graphHistory.picture.length > 0 : undefined}
	older={graphHistory.older}
	{lines}
	{conflicts}
	taking={graphHistory.taking}
	busy={graphHistory.busy}
	says={graphHistory.says}
	onShow={() => void graphHistory.opened()}
	onKeep={(message) => graphHistory.keep(message)}
	onOlder={() => void graphHistory.readOlder()}
	onStartLine={(name) => graphHistory.startLine(name)}
	onWorkOn={(name) => graphHistory.workOn(name)}
	onBringIn={(name) => graphHistory.bringIn(name)}
	onSettle={(path) => {
		settling = path;
		settleOpen = true;
	}}
	onStopBringingIn={() => graphHistory.abandonMerge()}
	onOpenVersion={onShowVersion ? (id) => void showVersion(id) : undefined}
	onCompare={compare}
	picture={graphHistory.draws ? theShape : undefined}
	branches={graphHistory.draws ? theLines : undefined}
	elsewhere={graphHistory.draws ? theOtherPlaces : undefined}
/>

{#snippet theShape()}
	<CommitGraph
		versions={drawnVersions}
		at={graphHistory.at}
		on={graphHistory.line}
		elsewhere={linesElsewhere}
		signs={graphHistory.signs}
		older={graphHistory.morePicture}
		busy={graphHistory.busy}
		onOlder={() => void graphHistory.readOlderPicture()}
		onOpen={openVersion}
	/>
{/snippet}

{#snippet theLines()}
	<BranchesPanel
		lines={lineRows}
		anyVersion={graphHistory.versions.length > 0}
		busy={graphHistory.busy}
		unsettled={graphHistory.inTwoVersions.length > 0}
		onStartLine={(name) => graphHistory.startLine(name)}
		onWorkOn={(name) => graphHistory.workOn(name)}
		onBringIn={(name) => graphHistory.bringIn(name)}
		onDrop={(name) => graphHistory.dropLine(name)}
		onStartFrom={(name, head) => graphHistory.startLineAt(name, head)}
	/>
{/snippet}

{#snippet theOtherPlaces()}
	<SyncControls
		{places}
		chosen={there}
		ahead={standing?.ahead}
		behind={standing?.behind}
		busy={graphHistory.busy}
		said={graphHistory.elsewhereSaid}
		onPick={(name) => (where = name)}
		onLook={(name) => void graphHistory.lookElsewhere(name)}
		onTakeIn={(name) => void graphHistory.takeIn(name)}
		onPutThere={(name) => void graphHistory.putElsewhere(name)}
	/>
{/snippet}

{#if opened !== null}
	<CommitDetails
		bind:open={showingOpen}
		version={opened}
		{springsFrom}
		linesHere={linesAt}
		signs={graphHistory.signs}
		busy={graphHistory.busy}
		says={graphHistory.says}
		onRead={onShowVersion ? (id) => void showVersion(id) : undefined}
		onCompare={onShowDifference ? (id) => void compareWithNow(id) : undefined}
		onOpen={openVersion}
		onStartLine={(name, id) => graphHistory.startLineAt(name, id)}
		onWorkOn={(name) => graphHistory.workOn(name)}
	/>
{/if}

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
