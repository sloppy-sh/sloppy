<script lang="ts" module>
	/** One thing a line being brought in left in two versions. */
	export interface NoteInTwo {
		/** What the history calls it, which is what settles it. */
		path: string;
		title: string;
		address?: string;
		/** What it is, once the graph has read it: a note is settled section by
		 *  section, anything else only whole. Absent is one still being read. */
		isNote?: boolean;
	}
</script>

<script lang="ts">
	// A line part-way into the one the folder is on, note by note — DESIGN.md
	// § "The history": it stands until it is finished, and after a reload.
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		taking,
		notes,
		busy = false,
		says = null,
		onSettle,
		onFinish,
		onStop
	}: {
		/** The line being brought in, as a person reads it. */
		taking: string;
		/** What is still in two versions. Empty is a line waiting to be kept. */
		notes: readonly NoteInTwo[];
		busy?: boolean;
		says?: string | null;
		onSettle: (path: string) => void;
		/** Keeping a version is what finishes it. */
		onFinish: () => void;
		onStop: () => Promise<boolean>;
	} = $props();

	let stopping = $state(false);

	const left = $derived(notes.length);

	function named(note: NoteInTwo): string {
		if (note.isNote === undefined) return 'Reading this one…';
		if (!note.isNote) return 'Something else your graph keeps for you';
		return note.title || 'Untitled';
	}

	async function stop(): Promise<void> {
		if (!(await onStop())) throw new Error(says ?? '');
	}
</script>

<section class="space-y-3">
	<h3 class="text-sm font-medium">Bringing in {taking}</h3>

	{#if left === 0}
		<p class="text-sm text-muted-foreground">
			Every note is settled. Keep a version and {taking} is in.
		</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			{left === 1
				? `One note is in two versions: you and ${taking} both wrote in it.`
				: `${left.toLocaleString()} notes are in two versions: you and ${taking} both wrote in them.`}
			Choose what each one says, then keep a version.
		</p>
		<ul class="space-y-1">
			{#each notes as note (note.path)}
				<li>
					<button
						type="button"
						class="flex min-h-control w-full items-baseline gap-2 rounded-md px-2 text-left text-sm hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
						disabled={note.isNote === undefined}
						onclick={() => onSettle(note.path)}
					>
						{#if note.address}
							<span class="shrink-0 address text-xs">{note.address}</span>
						{/if}
						<span class="min-w-0 flex-1 truncate">{named(note)}</span>
						{#if note.isNote !== undefined}
							<span class="shrink-0 text-xs text-muted-foreground">Choose</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#if left === 0}
			<Button class="h-control" disabled={busy} onclick={onFinish}>Keep a version</Button>
		{/if}
		<Button variant="outline" class="h-control" disabled={busy} onclick={() => (stopping = true)}>
			Stop bringing it in
		</Button>
	</div>
</section>

<ConfirmModal
	bind:open={stopping}
	title="Stop bringing in {taking}?"
	description="Your graph goes back to the last version you kept. Nothing {taking} wrote stays, the choices you have made here are let go, and anything you have written since goes with them — keep a version first if you want to hold on to it."
	confirmLabel="Stop it"
	cancelLabel="Keep going"
	destructive={false}
	refused={says}
	onconfirm={stop}
/>
