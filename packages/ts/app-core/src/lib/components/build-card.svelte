<script lang="ts">
	// The whole of a build, as one card read top to bottom and again as the work
	// happens — DESIGN.md § "A build". It stands at the head of its own thread,
	// and there is no step to advance and nothing to dismiss.
	import type { Build, BuildSlug, ContextUsage, OwnedRef, Ulid } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import {
		buildSaid,
		DISCARD_COSTS,
		over,
		questionsOf,
		tasksOf,
		waitingOn,
		working
	} from './build-said.js';
	import BuildQuestions from './build-questions.svelte';
	import BuildResult from './build-result.svelte';
	import BuildTask from './build-task.svelte';

	let {
		build,
		busy = false,
		writing = false,
		says = null,
		taken = false,
		contextOf,
		nameOf,
		onGo,
		onAnswer,
		onDrop,
		onAddNote,
		onRemoveNote,
		onOpen,
		onStop,
		onCarryOn,
		onWorkOn,
		onBringIn,
		onDiscard,
		onNotes
	}: {
		build: Build;
		/** Whether an act is in flight, which is one at a time. */
		busy?: boolean;
		/** A note is already being written, so no question can ask for another. */
		writing?: boolean;
		/** Why the last act did not land, in words for the person. */
		says?: string | null;
		/** Whether the line has been brought into the reader's own. */
		taken?: boolean;
		/** How full a session's window is, as it last said. */
		contextOf: (conversation: Ulid) => ContextUsage | null;
		/** A note as somebody cites it, and nothing for one not in hand. */
		nameOf: (note: OwnedRef) => string | undefined;
		onGo: () => void;
		onAnswer: (need: BuildSlug) => void;
		onDrop: (need: BuildSlug) => void;
		onAddNote: (task: BuildSlug) => void;
		onRemoveNote: (task: BuildSlug, note: OwnedRef) => void;
		onOpen: (note: OwnedRef) => void;
		onStop: () => void;
		onCarryOn: () => void;
		/** Put the reader on the line to run what was built. Absent where the
		 *  line's version is not in hand. */
		onWorkOn?: () => void;
		onBringIn: () => void;
		onDiscard: () => void;
		/** The build's notes set against the reader's own. */
		onNotes?: () => void;
	} = $props();

	const tasks = $derived(tasksOf(build));
	const questions = $derived(questionsOf(build));
	const unanswered = $derived(waitingOn(build));
	const disputes = $derived(build.plan?.disputes ?? []);
	const ended = $derived(over(build.state));

	/** The newest session of a task, which is the one with a window to fill. */
	function liveContext(task: BuildSlug): ContextUsage | null {
		const held = [...build.sessions].reverse().find((one) => one.task === task);
		return held ? contextOf(held.conversation) : null;
	}

	function titleOf(task: BuildSlug): string | undefined {
		return build.plan?.tasks.find((one) => one.id === task)?.title;
	}

	let asking = $state(false);
</script>

<article class="space-y-3 rounded-xl border border-border px-3 py-3" data-build-card={build.id}>
	<header class="space-y-1">
		<div class="flex min-w-0 items-center gap-2">
			<h3 class="min-w-0 flex-1 truncate text-sm font-medium">{build.name}</h3>
			{#if working(build.state)}
				<Button variant="ghost" class="h-9 shrink-0 px-2 text-xs" disabled={busy} onclick={onStop}>
					Stop
				</Button>
			{:else if build.state === 'stopped'}
				<Button
					variant="ghost"
					class="h-9 shrink-0 px-2 text-xs"
					disabled={busy}
					onclick={onCarryOn}
				>
					Continue
				</Button>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground" role="status" data-build-state={build.state}>
			{buildSaid(build.state)}
		</p>
		{#if says}
			<p class="text-xs text-destructive" role="alert">{says}</p>
		{/if}
	</header>

	{#if questions.length > 0}
		<section class="space-y-1">
			<h4 class="text-xs font-medium text-muted-foreground">Needs</h4>
			<BuildQuestions
				{questions}
				{busy}
				{writing}
				{nameOf}
				{titleOf}
				{onAnswer}
				{onDrop}
				{onOpen}
			/>
		</section>
	{/if}

	{#if disputes.length > 0}
		<section class="space-y-1">
			<h4 class="text-xs font-medium text-muted-foreground">Where the account disagrees</h4>
			<ul class="space-y-2">
				{#each disputes as dispute, at (at)}
					<li class="rounded-lg border border-border px-3 py-2" data-build-dispute>
						<p class="text-sm break-words">{dispute.what}</p>
						<ul class="mt-1 flex flex-wrap gap-1">
							{#each dispute.notes as note (note)}
								{@const name = nameOf(note)}
								<li>
									<button
										type="button"
										class="inline-flex min-h-8 max-w-48 items-center truncate rounded-full border border-border px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										onclick={() => onOpen(note)}
									>
										{name ?? 'A note'}
									</button>
								</li>
							{/each}
						</ul>
						{#if dispute.path}
							<p class="mt-1 text-xs break-all text-muted-foreground">{dispute.path}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if tasks.length > 0}
		<section class="space-y-1">
			<h4 class="text-xs font-medium text-muted-foreground">The plan</h4>
			<ul class="space-y-2">
				{#each tasks as read (read.id)}
					<BuildTask
						{read}
						editable={build.state === 'answering'}
						context={liveContext(read.id)}
						{nameOf}
						{onOpen}
						onAdd={() => onAddNote(read.id)}
						onRemove={(note) => onRemoveNote(read.id, note)}
					/>
				{/each}
			</ul>
		</section>
	{/if}

	{#if ended}
		<BuildResult {build} {taken} {nameOf} {onOpen} {onNotes} />
	{/if}

	<!-- Pinned to the foot of the dock it scrolls in, which on a phone is the
	     screen — DESIGN.md § "A build". `SideDock` clears the system bar. -->
	{#if build.state === 'answering'}
		<footer class="sticky bottom-0 -mx-3 -mb-3 space-y-1 bg-background/95 px-3 py-3 backdrop-blur">
			<Button class="h-control w-full" disabled={busy} onclick={onGo}>Go</Button>
			{#if unanswered > 0}
				<p class="text-xs text-muted-foreground">
					{unanswered === 1
						? '1 question is unanswered'
						: `${unanswered} questions are unanswered`}.
				</p>
			{/if}
		</footer>
	{:else if ended}
		<footer
			class="sticky bottom-0 -mx-3 -mb-3 flex flex-col gap-2 bg-background/95 px-3 py-3 backdrop-blur"
		>
			{#if onWorkOn}
				<Button variant="outline" class="h-control" disabled={busy} onclick={onWorkOn}>
					Work on this version
				</Button>
			{/if}
			<Button class="h-control" disabled={busy} onclick={onBringIn}>Bring it in</Button>
			<Button variant="ghost" class="h-control" disabled={busy} onclick={() => (asking = true)}>
				Discard
			</Button>
		</footer>
	{/if}
</article>

<ResponsiveModal bind:open={asking} title="Discard this build?" description={DISCARD_COSTS}>
	<div class="flex flex-col gap-2 px-2 pt-4">
		<Button
			class="h-control sm:h-9"
			disabled={busy}
			onclick={() => {
				asking = false;
				onDiscard();
			}}
		>
			Discard it
		</Button>
		<Button variant="ghost" class="h-control sm:h-9" onclick={() => (asking = false)}>
			Keep it
		</Button>
	</div>
</ResponsiveModal>
