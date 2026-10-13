<script lang="ts">
	// What was built, read where the person reads code: the places it wrote, what
	// each check said, the notes it wrote as a difference, and the merges —
	// DESIGN.md § "A build". There is no diff viewer here, deliberately.
	import type { Build, OwnedRef } from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import {
		type BuildBrought,
		broughtSaid,
		checkSaid,
		filesOf,
		notesOf,
		tasksOf
	} from './build-said.js';

	let {
		build,
		brought = 'open',
		nameOf,
		onOpen,
		onNotes
	}: {
		build: Build;
		/** How far the line has got into the reader's own. */
		brought?: BuildBrought;
		nameOf: (note: OwnedRef) => string | undefined;
		onOpen: (note: OwnedRef) => void;
		/** The build's notes set against the folder's. Absent where the line's
		 *  version is not in hand. */
		onNotes?: () => void;
	} = $props();

	const built = $derived(tasksOf(build).filter((one) => one.last !== undefined));
	const files = $derived(filesOf(build));
	const notes = $derived(notesOf(build));
	const checks = $derived(build.checked ?? []);
</script>

<section class="space-y-3" data-build-result>
	{#if built.length > 0}
		<div>
			<h4 class="text-xs font-medium text-muted-foreground">What was built</h4>
			<ul class="mt-1 space-y-1">
				{#each built as one (one.id)}
					<li class="text-sm break-words">
						<span class="font-medium">{one.task.title}</span>
						<span class="text-muted-foreground"> — {one.last?.summary}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if files.length > 0}
		<div>
			<h4 class="text-xs font-medium text-muted-foreground">Where it wrote</h4>
			<ul class="mt-1 space-y-0.5">
				{#each files as path (path)}
					<li class="text-xs break-all">{path}</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if checks.length > 0}
		<div>
			<h4 class="text-xs font-medium text-muted-foreground">The checks</h4>
			<ul class="mt-1 space-y-1">
				{#each checks as check, at (at)}
					<li data-build-check={check.passed ? 'passed' : 'failed'}>
						<div class="flex min-w-0 items-baseline gap-2">
							<span class="min-w-0 flex-1 truncate text-xs">{check.command}</span>
							<span
								class="shrink-0 text-xs {check.passed
									? 'text-muted-foreground'
									: 'text-destructive'}"
							>
								{checkSaid(check)}
							</span>
						</div>
						{#if check.said !== ''}
							<details>
								<summary
									class="inline-flex min-h-8 cursor-pointer list-none items-center text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								>
									What it said
								</summary>
								<pre
									class="mt-1 max-h-48 overflow-auto border-l border-border pl-3 text-xs break-words whitespace-pre-wrap select-text">{check.said}</pre>
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if notes.length > 0}
		<div>
			<h4 class="text-xs font-medium text-muted-foreground">The notes it wrote</h4>
			<ul class="mt-1 flex flex-wrap gap-1">
				{#each notes as note (note)}
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
			{#if onNotes}
				<Button variant="ghost" class="mt-1 h-9 px-2 text-xs" onclick={onNotes}>
					See them against your own
				</Button>
			{/if}
		</div>
	{/if}

	<div>
		<h4 class="text-xs font-medium text-muted-foreground">The merges</h4>
		<ul class="mt-1 space-y-0.5">
			{#each build.merges as merge (merge.task)}
				<li class="text-xs break-words" data-build-merge={merge.task}>
					{build.plan?.tasks.find((task) => task.id === merge.task)?.title ?? merge.task} into the line
					— {merge.settled
						? merge.conflicts.length === 0
							? 'it went in by itself'
							: `settled in ${merge.conflicts.length === 1 ? '1 file' : `${merge.conflicts.length} files`}`
						: 'not in yet'}
				</li>
			{/each}
			<li class="text-xs break-words" data-build-merge="line">
				{build.name} into your own — {broughtSaid(brought)}
			</li>
		</ul>
	</div>
</section>
