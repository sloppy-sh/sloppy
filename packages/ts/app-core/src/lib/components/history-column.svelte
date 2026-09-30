<script lang="ts">
	// The history beside the graph: where the folder stands, what is unkept,
	// somewhere to keep it, and the versions — DESIGN.md § "The history as a
	// picture". Everything a narrow column has no room for is one row away, in
	// the surface that has always held it.
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { WHILE_WRITING } from '../stores/autosave.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { drawnFrom, foldRuns } from './commit-graph.js';
	import CommitGraph from './commit-graph.svelte';

	/** How much of a version's name the picture draws, and a person cites. */
	const SHORT_NAME = 8;

	const BEFORE_MOVING = 'Before moving on';

	let {
		onOpenAll,
		lineOpened = null
	}: {
		/** Everything a column has no room for: the lines in full, the other
		 *  places, and what is different. */
		onOpenAll: () => void;
		/** A line somebody's writing opened where they stood, said once while the
		 *  folder is still on it. */
		lineOpened?: string | null;
	} = $props();

	/** Somewhere the folder is going, once writing nobody has kept is answered
	 *  for. `carries` is whether the act can take that writing along. */
	interface Leaving {
		carries: boolean;
		go: (carrying: boolean) => Promise<boolean>;
	}

	let message = $state('');
	let keeping = $state(false);
	/** Runs of versions nobody wrote a message for that somebody has opened. */
	let opened = $state.raw<ReadonlySet<string>>(new Set());
	/** The version somebody tapped, offered its acts. */
	let picked = $state.raw<string | null>(null);
	let leaving = $state.raw<Leaving | null>(null);
	let asking = $state(false);
	let going = $state(false);
	/** So a refusal from before this question is not read as its answer. */
	let tried = $state(false);
	let leavingMessage = $state(BEFORE_MOVING);
	let renaming = $state<string | null>(null);

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
	const standingOn = $derived(
		graphHistory.onAVersion ? graphHistory.at?.slice(0, SHORT_NAME) : undefined
	);
	const openedLine = $derived(
		lineOpened !== null && graphHistory.line === lineOpened ? lineOpened : null
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

	/** Nothing moves the folder over writing nobody has kept without asking
	 *  first, every time — DESIGN.md § "The history as a picture". */
	async function leaveFor(what: Leaving): Promise<void> {
		picked = null;
		if (!graphHistory.unkept) {
			await what.go(false);
			return;
		}
		leavingMessage = BEFORE_MOVING;
		tried = false;
		leaving = what;
		asking = true;
	}

	async function takeTheWayOut(run: () => Promise<boolean>): Promise<void> {
		if (going) return;
		going = true;
		tried = true;
		try {
			if (await run()) asking = false;
		} finally {
			going = false;
		}
	}

	function keepFirst(): Promise<void> {
		const what = leaving;
		const says = leavingMessage.trim();
		if (!what || says === '') return Promise.resolve();
		return takeTheWayOut(async () => {
			if (graphHistory.unkept && !(await graphHistory.keep(says))) return false;
			return what.go(false);
		});
	}

	function bringThem(): Promise<void> {
		const what = leaving;
		return what ? takeTheWayOut(() => what.go(true)) : Promise.resolve();
	}

	function workOnVersion(at: string): Promise<void> {
		return leaveFor({ carries: true, go: (carrying) => graphHistory.standOn(at, carrying) });
	}

	function lineFrom(at: string): Promise<void> {
		return leaveFor({
			carries: true,
			go: async (carrying) =>
				(await graphHistory.standOn(at, carrying)) && (await graphHistory.lineHere()) !== null
		});
	}

	function workOnLine(name: string): Promise<void> {
		return leaveFor({ carries: false, go: () => graphHistory.workOn(name) });
	}

	async function rename(): Promise<void> {
		const from = openedLine;
		const to = renaming?.trim();
		if (from === null || to === undefined || to === '' || to === from) return;
		if (await graphHistory.renameLine(from, to)) renaming = null;
	}
</script>

{#snippet acts(at: string)}
	<div class="flex flex-col gap-0.5">
		{#if !(graphHistory.onAVersion && graphHistory.at === at)}
			<Button
				variant="ghost"
				class="h-control justify-start text-xs"
				onclick={() => void workOnVersion(at)}
			>
				Work on this version
			</Button>
		{/if}
		<Button
			variant="ghost"
			class="h-control justify-start text-xs"
			onclick={() => void lineFrom(at)}
		>
			Start a line here
		</Button>
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
{/snippet}

<div class="flex min-h-0 flex-col gap-2">
	{#if standingOn}
		<p class="shrink-0 px-1 text-xs text-muted-foreground" role="status">
			Working on a version, {standingOn}.
		</p>
	{/if}

	{#if openedLine !== null}
		<div class="flex shrink-0 flex-col gap-2 px-1">
			<p class="text-xs text-muted-foreground" role="status">
				Your writing opened a new line, {openedLine}.
			</p>
			{#if renaming === null}
				<Button
					variant="ghost"
					class="h-control self-start text-xs"
					onclick={() => (renaming = openedLine)}
				>
					Rename
				</Button>
			{:else}
				<div class="flex gap-2">
					<Input
						bind:value={renaming}
						class="h-control flex-1 text-sm"
						autocomplete="off"
						maxlength={128}
						aria-label="What this line is called"
						onkeydown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							void rename();
						}}
					/>
					<Button
						variant="outline"
						class="h-control shrink-0 text-xs"
						disabled={graphHistory.busy}
						onclick={rename}
					>
						Rename it
					</Button>
				</div>
			{/if}
		</div>
	{/if}

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
					onclick={() => void workOnLine(line.name)}
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
				openAt={picked}
				onStandingFor={(id) => (opened = new Set([...opened, id]))}
				onOlder={() => void graphHistory.readOlderPicture()}
				onOpen={(id) => (picked = picked === id ? null : id)}
				{acts}
			/>
		</div>
	{/if}

	<Button variant="ghost" class="h-control shrink-0 text-xs" onclick={onOpenAll}>
		Lines, other places and what is different
	</Button>
</div>

<ResponsiveModal
	bind:open={asking}
	title="You have writing nobody has kept"
	description={leaving?.carries
		? 'Keep it as a version first, or bring it with you.'
		: 'Keep it as a version first, or stay where you are.'}
>
	<div class="flex flex-col gap-3 px-2 pt-4">
		<Input
			bind:value={leavingMessage}
			class="h-control text-sm"
			aria-label="What this version is"
			placeholder="What you did"
		/>
		{#if tried && graphHistory.says}
			<p class="text-sm text-destructive" role="alert">{graphHistory.says}</p>
		{/if}
		<div class="flex flex-col gap-2">
			<Button
				class="h-control sm:h-9"
				disabled={going || leavingMessage.trim() === ''}
				onclick={keepFirst}
			>
				Keep a version first
			</Button>
			{#if leaving?.carries}
				<Button variant="outline" class="h-control sm:h-9" disabled={going} onclick={bringThem}>
					Bring them with me
				</Button>
			{/if}
			<Button
				variant="ghost"
				class="h-control sm:h-9"
				disabled={going}
				onclick={() => (asking = false)}
			>
				Stay here
			</Button>
		</div>
	</div>
</ResponsiveModal>
