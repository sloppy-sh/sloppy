<script lang="ts">
	// The history beside the graph: what is unkept, somewhere to keep it, and
	// the picture — DESIGN.md § "The history as a picture". Everything a
	// narrow column has no room for is one row away, in the surface that has
	// always held it.
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { WHILE_WRITING } from '../stores/autosave.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { drawnFrom, foldRuns } from './commit-graph.js';
	import CommitGraph from './commit-graph.svelte';

	let {
		onOpenAll,
		onOpenVersion
	}: {
		/** Everything a column has no room for: the lines, the other places, and
		 *  what is different. */
		onOpenAll: () => void;
		onOpenVersion: (id: string) => void;
	} = $props();

	let message = $state('');
	let keeping = $state(false);
	/** Runs of versions nobody wrote a message for that somebody has opened. */
	let opened = $state.raw<ReadonlySet<string>>(new Set());

	const changed = $derived(graphHistory.changed?.notes.length ?? 0);
	const folded = $derived(foldRuns(drawnFrom(graphHistory.picture), WHILE_WRITING, opened));

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

	function unfold(id: string): void {
		opened = new Set([...opened, id]);
	}
</script>

<div class="flex min-h-0 flex-col gap-2">
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
				onStandingFor={unfold}
				onOlder={() => void graphHistory.readOlderPicture()}
				onOpen={onOpenVersion}
			/>
		</div>
	{/if}

	<Button variant="ghost" class="h-control shrink-0 text-xs" onclick={onOpenAll}>
		Lines, other places and what is different
	</Button>
</div>
