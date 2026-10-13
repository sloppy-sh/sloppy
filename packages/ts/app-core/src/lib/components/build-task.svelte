<script lang="ts">
	// One piece of the work, read as what it is FOR — DESIGN.md § "A build".
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import type { ContextUsage, OwnedRef } from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import { taskSaid, type TaskRead } from './build-said.js';
	import ContextChart from './context-chart.svelte';

	let {
		read,
		editable = false,
		context = null,
		nameOf,
		onOpen,
		onAdd,
		onRemove
	}: {
		read: TaskRead;
		/** Whether the notes it is built from are still the reader's to change,
		 *  which is until the build starts. */
		editable?: boolean;
		/** How full its session's window is; null draws no bar. */
		context?: ContextUsage | null;
		/** A note as somebody cites it, and nothing for one not in hand. */
		nameOf: (note: OwnedRef) => string | undefined;
		onOpen: (note: OwnedRef) => void;
		onAdd?: () => void;
		onRemove?: (note: OwnedRef) => void;
	} = $props();

	const findings = $derived(read.run.review?.findings ?? []);
	let chartOpen = $state(false);
</script>

<li class="rounded-lg border border-border px-3 py-2" data-build-task={read.id}>
	<div class="flex min-w-0 items-baseline gap-2">
		<h4 class="min-w-0 flex-1 text-sm font-medium">{read.task.title}</h4>
		<span class="shrink-0 text-xs text-muted-foreground" data-task-state={read.run.state}>
			{taskSaid(read.run.state)}
		</span>
	</div>

	<p class="mt-1 text-xs break-words text-muted-foreground">{read.task.effect}</p>

	<ul class="mt-2 flex flex-wrap items-center gap-1" aria-label="The notes this task is built from">
		{#each read.task.notes as note (note)}
			{@const name = nameOf(note)}
			<li
				class="inline-flex min-w-0 items-center rounded-full border border-border py-0.5 pr-0.5 pl-2 text-xs"
			>
				<button
					type="button"
					class="min-h-8 min-w-0 max-w-40 truncate text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onclick={() => onOpen(note)}
				>
					{name ?? 'A note'}
				</button>
				{#if editable && onRemove}
					<Button
						variant="ghost"
						class="size-7 shrink-0 rounded-full"
						aria-label={`Leave ${name ?? 'this note'} out of ${read.task.title}`}
						onclick={() => onRemove(note)}
					>
						<X class="size-3" />
					</Button>
				{/if}
			</li>
		{/each}
		{#if editable && onAdd}
			<li>
				<Button
					variant="ghost"
					class="h-8 gap-1 rounded-full px-2 text-xs"
					aria-label={`Add a note to ${read.task.title}`}
					onclick={onAdd}
				>
					<Plus class="size-3" />
					Add a note
				</Button>
			</li>
		{/if}
	</ul>

	<p class="mt-1 text-xs text-muted-foreground">
		{read.task.paths.join(' · ')}
	</p>

	{#if context}
		<div class="mt-2">
			<ContextChart usage={context} bind:open={chartOpen} />
		</div>
	{/if}

	{#if findings.length > 0}
		<ul class="mt-2 space-y-1" aria-label={`What was found in ${read.task.title}`}>
			{#each findings as finding, at (at)}
				<li
					class="rounded-md border border-border/60 px-2 py-1.5 text-xs"
					data-build-finding={finding.severity}
				>
					<p class="font-medium break-words">
						{finding.file}{finding.line === undefined ? '' : `:${finding.line}`}
					</p>
					<p class="mt-0.5 break-words">{finding.what}</p>
					<p class="mt-0.5 break-words text-muted-foreground">{finding.why}</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if read.last?.undone}
		<p class="mt-2 text-xs break-words text-muted-foreground">
			Left undone: {read.last.undone}
		</p>
	{/if}
</li>
