<script lang="ts">
	// What was built, read through the notes it was built from: each task with
	// what it was for, the files it wrote and the notes that lead to each, what
	// each check said, the notes it wrote as a difference, and the merges —
	// DESIGN.md § "A build". There is no diff viewer here, deliberately.
	import FileCode from '@lucide/svelte/icons/file-code';
	import { A_NOTE, type Build, type CodeAnchor, type OwnedRef } from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import { provenanceOver, type WhyHere } from '../code-provenance.js';
	import { api } from '../api.js';
	import {
		type BuildBrought,
		broughtSaid,
		checkSaid,
		citedAs,
		notesOf,
		tasksOf
	} from './build-said.js';
	import CodeSheet from './code-sheet.svelte';

	const FILES_AS_KEPT =
		'Files open as your folder has them. Work on this version, or bring it in, to read what was built.';

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
		/** The build's notes set against the folder's. */
		onNotes: () => void;
	} = $props();

	const built = $derived(tasksOf(build).filter((one) => one.last !== undefined));
	const notes = $derived(notesOf(build));
	const checks = $derived(build.checked ?? []);

	let reachable = $state(false);
	let showing = $state(false);
	let shownAnchor = $state.raw<CodeAnchor | null>(null);
	/** The notes whose places reach each file the build wrote. */
	let reaching = $state.raw<ReadonlyMap<string, WhyHere[]>>(new Map());

	$effect(() => {
		const paths = [...new Set(built.flatMap((one) => one.last?.files ?? []))];
		if (!reachable || paths.length === 0) return;
		const why = provenanceOver(api);
		let live = true;
		void Promise.all(
			paths.map(async (path) => [path, await why(path).catch(() => [])] as const)
		).then((found) => {
			if (live) reaching = new Map(found);
		});
		return () => {
			live = false;
		};
	});

	/** The notes a file reads through: the ones its task was built from, then
	 *  the ones pointing into it, each once. */
	function notesFor(from: readonly OwnedRef[], path: string): { ref: OwnedRef; name: string }[] {
		const every = [
			...from.map((ref) => ({ ref, name: nameOf(ref) ?? A_NOTE })),
			...(reaching.get(path) ?? []).map((one) => ({ ref: one.ref, name: citedAs(one) ?? A_NOTE }))
		];
		return every.filter((one, at) => every.findIndex((other) => other.ref === one.ref) === at);
	}

	function show(path: string): void {
		shownAnchor = { path };
		showing = true;
	}
</script>

{#snippet heading(words: string)}
	<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{words}</h4>
{/snippet}

{#snippet noteChip(ref: OwnedRef, name: string)}
	<button
		type="button"
		class="inline-flex min-h-8 max-w-64 min-w-0 items-center rounded-full border border-border px-2 text-xs transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		onclick={() => onOpen(ref)}
	>
		<span class="min-w-0 truncate">{name}</span>
	</button>
{/snippet}

<section class="divide-y divide-border border-t border-border" data-build-result>
	{#if built.length > 0}
		<div class="space-y-3 py-3">
			{@render heading('What was built')}
			<p class="text-xs text-muted-foreground">{FILES_AS_KEPT}</p>
			{#each built as one (one.id)}
				<div class="space-y-2" data-build-built={one.id}>
					<div class="space-y-0.5">
						<p class="text-sm font-medium break-words">{one.task.title}</p>
						<p class="text-xs break-words text-muted-foreground">{one.last?.summary}</p>
					</div>
					<p class="border-l border-foreground/70 pl-2 text-xs break-words">
						{one.task.effect}
					</p>
					{#if (one.last?.files.length ?? 0) > 0}
						<ul class="space-y-2" aria-label={`Where ${one.task.title} wrote`}>
							{#each one.last?.files ?? [] as path (path)}
								{@const through = notesFor(one.task.notes, path)}
								<li class="space-y-1" data-build-file={path}>
									{#if reachable}
										<button
											type="button"
											class="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md text-left text-xs transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
											onclick={() => show(path)}
										>
											<FileCode class="size-3.5 shrink-0 text-muted-foreground" />
											<span class="min-w-0 font-mono break-all">{path}</span>
										</button>
									{:else}
										<p class="flex min-h-8 min-w-0 items-center gap-1.5 text-xs">
											<FileCode class="size-3.5 shrink-0 text-muted-foreground" />
											<span class="min-w-0 font-mono break-all">{path}</span>
										</p>
									{/if}
									{#if through.length > 0}
										<ul
											class="flex flex-wrap gap-1 pl-5"
											aria-label={`The notes ${path} reads through`}
										>
											{#each through as note (note.ref)}
												<li>{@render noteChip(note.ref, note.name)}</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if checks.length > 0}
		<div class="space-y-1 py-3">
			{@render heading('The checks')}
			<ul class="space-y-1">
				{#each checks as check, at (at)}
					<li data-build-check={check.passed ? 'passed' : 'failed'}>
						<div class="flex min-w-0 items-baseline gap-2">
							<span class="min-w-0 flex-1 truncate font-mono text-xs">{check.command}</span>
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
		<div class="space-y-1 py-3">
			{@render heading('The notes it wrote')}
			<ul class="flex flex-wrap gap-1">
				{#each notes as note (note)}
					<li>{@render noteChip(note, nameOf(note) ?? A_NOTE)}</li>
				{/each}
			</ul>
			<Button variant="ghost" class="h-9 px-2 text-xs" onclick={onNotes}>
				See them against your own
			</Button>
		</div>
	{/if}

	<div class="space-y-1 py-3">
		{@render heading('The merges')}
		<ul class="space-y-1">
			{#each build.merges as merge (merge.task)}
				<li class="text-xs break-words" data-build-merge={merge.task}>
					{build.plan?.tasks.find((task) => task.id === merge.task)?.title ?? merge.task} into the line
					—
					<span class="text-muted-foreground"
						>{merge.settled
							? merge.conflicts.length === 0
								? 'it went in by itself'
								: `settled in ${merge.conflicts.length === 1 ? '1 file' : `${merge.conflicts.length} files`}`
							: 'not in yet'}</span
					>
				</li>
			{/each}
			<li class="text-xs break-words" data-build-merge="line">
				{build.name} into your own —
				<span class="text-muted-foreground">{broughtSaid(brought)}</span>
			</li>
		</ul>
	</div>
</section>

<CodeSheet
	bind:open={showing}
	onReachable={(is) => (reachable = is)}
	anchor={shownAnchor}
	onOpenNote={onOpen}
/>
