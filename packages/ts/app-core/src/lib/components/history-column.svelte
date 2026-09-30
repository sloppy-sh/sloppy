<script lang="ts">
	// The history beside the graph: which line the folder is on, what is unkept,
	// somewhere to keep it, and the versions — DESIGN.md § "The history as a
	// picture". Everything a narrow column has no room for is one row away, in
	// the surface that has always held it.
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { WHILE_WRITING } from '../stores/autosave.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { drawnFrom, foldRuns } from './commit-graph.js';
	import CommitGraph from './commit-graph.svelte';

	let {
		onOpenAll,
		onReadVersion
	}: {
		/** Everything a column has no room for: the lines in full, the other
		 *  places, and what is different. */
		onOpenAll: () => void;
		/** Put a version on the graph as it was, to read against what is there
		 *  now. Absent where there is no graph on screen to draw one on. */
		onReadVersion?: (commit: string) => void;
	} = $props();

	let message = $state('');
	let keeping = $state(false);
	/** Runs of versions nobody wrote a message for that somebody has opened. */
	let opened = $state.raw<ReadonlySet<string>>(new Set());
	/** The version somebody tapped, offered its two acts. */
	let picked = $state.raw<string | null>(null);

	// The history is asked for as soon as this stands: a picture nobody asked
	// for is an empty one, and an empty one reads as a graph with no history.
	$effect(() => {
		void graphHistory.opened();
	});

	const changed = $derived(graphHistory.changed?.notes.length ?? 0);
	const folded = $derived(foldRuns(drawnFrom(graphHistory.picture), WHILE_WRITING, opened));
	/** The lines this folder keeps, the one it is on first. */
	const lines = $derived(
		[...graphHistory.lines]
			.filter((one) => one.remote === undefined)
			.sort((a, b) => Number(b.current) - Number(a.current))
	);

	async function keep(): Promise<void> {
		const said = message.trim();
		if (said === '' || keeping) return;
		keeping = true;
		try {
			if (await graphHistory.keep(said)) message = '';
		} finally {
			keeping = false;
		}
	}
</script>

<div class="flex min-h-0 flex-col gap-2">
	{#if lines.length > 0}
		<div
			class="flex shrink-0 flex-wrap gap-1"
			role="group"
			aria-label="The lines this folder keeps"
		>
			{#each lines as line (line.name)}
				<button
					type="button"
					aria-pressed={line.current}
					disabled={graphHistory.busy || line.current}
					onclick={() => void graphHistory.workOn(line.name)}
					class="inline-flex min-h-control max-w-full items-center rounded-full border px-2.5 text-xs disabled:opacity-100 {line.current
						? 'border-foreground font-medium'
						: 'border-border text-muted-foreground hover:bg-muted/60'}"
				>
					<span class="min-w-0 truncate">{line.name}</span>
				</button>
			{/each}
		</div>
	{/if}

	<form
		class="flex shrink-0 flex-col gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			void keep();
		}}
	>
		<Input
			bind:value={message}
			class="h-control text-sm"
			aria-label="What this version is"
			placeholder="What you did"
		/>
		<Button
			type="submit"
			variant="outline"
			class="h-control text-sm"
			disabled={keeping || message.trim() === '' || !graphHistory.unkept}
		>
			Keep a version
		</Button>
	</form>

	<p class="shrink-0 px-1 text-xs text-muted-foreground" role="status">
		{#if !graphHistory.unkept}
			Everything is kept.
		{:else if changed === 0}
			Something is unkept.
		{:else}
			{changed === 1 ? '1 note' : `${changed} notes`} unkept.
		{/if}
	</p>

	{#if picked !== null}
		{@const at = picked}
		<div class="flex shrink-0 flex-col gap-1 rounded-md border border-border p-1">
			{#if onReadVersion}
				<Button
					variant="ghost"
					class="h-control justify-start text-xs"
					onclick={() => {
						onReadVersion(at);
						picked = null;
					}}
				>
					Read the graph as it was here
				</Button>
			{/if}
			<Button
				variant="ghost"
				class="h-control justify-start text-xs"
				onclick={() => {
					picked = null;
					onOpenAll();
				}}
			>
				Everything about this version
			</Button>
		</div>
	{/if}

	{#if folded.drawn.length > 0}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<CommitGraph
				versions={folded.drawn}
				at={graphHistory.at}
				on={graphHistory.line}
				elsewhere={[]}
				signs={graphHistory.signs}
				older={graphHistory.morePicture}
				busy={graphHistory.busy}
				standingFor={folded.holding}
				onStandingFor={(id) => (opened = new Set([...opened, id]))}
				onOlder={() => void graphHistory.readOlderPicture()}
				onOpen={(id) => (picked = picked === id ? null : id)}
			/>
		</div>
	{/if}

	<Button variant="ghost" class="h-control shrink-0 text-xs" onclick={onOpenAll}>
		Lines, other places and what is different
	</Button>
</div>
