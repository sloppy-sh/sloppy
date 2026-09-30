<script lang="ts" module>
	/** One version of a graph somebody kept. */
	export interface KeptVersion {
		id: string;
		/** What they said had changed. */
		message: string;
		/** Whoever kept it, where that is a name they chose to be called by.
		 *  Absent is a version with nothing to name them with. */
		author?: string;
		/** When, as the row shows it. */
		when: string;
		/** Whether it brought another line of work in. */
		merged: boolean;
	}

	/** A line of work the versions stand on. */
	export interface LineOfWork {
		name: string;
		/** The version it stands at. */
		head: string;
		/** Whether the folder is on it. */
		here: boolean;
	}

	/** A state of the graph somebody picked to compare. `at` absent is the
	 *  folder as it stands. */
	export interface StatePicked {
		at?: string;
		/** What the picker called it, for a surface that says which two. */
		label: string;
	}
</script>

<script lang="ts">
	// Every state a person's graph has been in: what has changed since the last
	// version they kept, the versions themselves, the lines of work they stand
	// on, and what is different between any two — docs/ARCHITECTURE.md § "The
	// vault's history".
	import Check from '@lucide/svelte/icons/check';
	import { type Snippet, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import ChangedNotes, { type ChangedNote, type ChangedPictures } from './changed-notes.svelte';
	import MergeUnderway, { type NoteInTwo } from './merge-underway.svelte';

	let {
		open = $bindable(false),
		changed,
		pictures,
		anythingToKeep = false,
		versions,
		anyKept,
		older = false,
		lines,
		conflicts = [],
		taking = null,
		settled = undefined,
		busy = false,
		says = null,
		onShow,
		onKeep,
		onOlder,
		onStartLine,
		onWorkOn,
		onBringIn,
		onSettle,
		onStopBringingIn,
		onOpenVersion,
		onCompare,
		picture,
		branches,
		elsewhere
	}: {
		open?: boolean;
		/** What has changed since the version the folder stands on; `null` where
		 *  it has not been read. */
		changed: readonly ChangedNote[] | null;
		/** The pictures that changed with it, which stand in no note. */
		pictures?: ChangedPictures;
		/** Whether there is anything to keep at all: a picture put in the graph
		 *  changes it without changing a note. */
		anythingToKeep?: boolean;
		/** Newest first, along the line the folder is on. */
		versions: readonly KeptVersion[];
		/** Whether a version is kept anywhere in the folder, across every line —
		 *  what the picture draws. Absent → the line's own versions are the whole
		 *  of what there is to show. */
		anyKept?: boolean;
		/** Whether there are older ones than these. */
		older?: boolean;
		lines: readonly LineOfWork[];
		/** What a line being brought in left in two versions; empty is one waiting
		 *  to be kept. */
		conflicts?: readonly NoteInTwo[];
		/** The line being brought in. `null` is a folder in the middle of
		 *  nothing, and the whole of what says one is part-way through. */
		taking?: string | null;
		/** How many notes a line being brought in has settled already. */
		settled?: number;
		busy?: boolean;
		says?: string | null;
		/** The surface has just opened, and what it shows is worth asking for. */
		onShow?: () => void;
		onKeep: (message: string) => Promise<boolean>;
		onOlder: () => void;
		onStartLine: (name: string) => Promise<boolean>;
		onWorkOn: (name: string) => Promise<boolean>;
		onBringIn: (name: string) => Promise<boolean>;
		onSettle: (path: string) => void;
		/** The folder back the way it was before the line was brought in. */
		onStopBringingIn: () => Promise<boolean>;
		/** Absent where a version cannot be put on the graph from here. */
		onOpenVersion?: (id: string) => void;
		onCompare: (
			before: StatePicked,
			after: StatePicked
		) => Promise<{ notes: readonly ChangedNote[]; pictures: ChangedPictures } | null>;
		/** The versions drawn as the shape they make. Absent → the list of them,
		 *  which is what a platform whose history cannot say what shape it is in
		 *  gets. */
		picture?: Snippet;
		/** The lines of work with how far each is from where it is also kept.
		 *  Absent → the lines by name alone. */
		branches?: Snippet;
		/** Where else the folder is kept, and what moves between here and there.
		 *  Absent → nothing about anywhere else. */
		elsewhere?: Snippet;
	} = $props();

	/** What the pickers hold for the folder as it stands, kept apart from the
	 *  versions so no id of one can collide with it. */
	const NOW = 'now';

	let keeping = $state(false);
	let message = $state('');
	let naming = $state('');
	let before = $state(NOW);
	let after = $state(NOW);
	let comparing = $state(false);
	let compared = $state<{ notes: readonly ChangedNote[]; pictures: ChangedPictures } | null>(null);

	$effect(() => {
		if (open) untrack(() => onShow?.());
	});

	/** A line standing at a version that is also in the log is one state, named
	 *  by the line: two options carrying it would be one state offered twice. */
	const states = $derived(
		[
			{ value: NOW, label: 'Now' },
			...lines
				.filter((one) => !one.here)
				.map((one) => ({ value: at(one.head), label: `${one.name}, as it stands` })),
			...versions.map((one) => ({ value: at(one.id), label: one.message || 'A version' }))
		].filter((state, held, all) => all.findIndex((one) => one.value === state.value) === held)
	);

	const kept = $derived(versions.length > 0);
	const unsettled = $derived(conflicts.length > 0);

	function at(version: string): string {
		return `at:${version}`;
	}

	function asked(value: string): string | undefined {
		return value === NOW ? undefined : value.slice('at:'.length);
	}

	function labelled(value: string): string {
		return states.find((one) => one.value === value)?.label ?? 'Now';
	}

	function picked(value: string): StatePicked {
		const held = asked(value);
		return { ...(held === undefined ? {} : { at: held }), label: labelled(value) };
	}

	/** A line brought in is finished by keeping a version, so the message is
	 *  already written and the person has only to keep it. */
	function finishBringingIn(): void {
		if (message.trim() === '') message = `Brought in ${taking}`;
		keeping = true;
	}

	async function keep(): Promise<void> {
		const said = message.trim();
		if (said === '') return;
		if (await onKeep(said)) {
			message = '';
			keeping = false;
			compared = null;
		}
	}

	/** A line taken or brought in moves what "now" means, so a difference read
	 *  against the old now is no longer true. */
	async function moveLine(act: () => Promise<boolean>): Promise<void> {
		if (await act()) compared = null;
	}

	async function startLine(): Promise<void> {
		const name = naming.trim();
		if (name === '') return;
		if (await onStartLine(name)) naming = '';
	}

	async function compare(): Promise<void> {
		comparing = true;
		try {
			compared = await onCompare(picked(before), picked(after));
		} finally {
			comparing = false;
		}
	}
</script>

<ResponsiveModal
	bind:open
	fill
	title="History"
	description="Every version of your graph you have kept, and what has changed since."
>
	<div class="space-y-8 px-2 pt-4 pb-2">
		{#if taking}
			<MergeUnderway
				{taking}
				notes={conflicts}
				{settled}
				{busy}
				{says}
				{onSettle}
				onFinish={finishBringingIn}
				onStop={onStopBringingIn}
			/>
		{/if}

		<section class="space-y-3">
			<h3 class="text-sm font-medium">Since your last version</h3>
			{#if changed === null}
				<p class="text-sm text-muted-foreground">Reading what has changed…</p>
			{:else}
				<ChangedNotes
					notes={changed}
					{pictures}
					nothing={!kept
						? 'Nothing is kept yet. Keep this version and you can come back to it.'
						: anythingToKeep
							? 'Something changed that is not written in a note.'
							: 'Nothing has changed since your last version.'}
				/>
			{/if}
			<Button
				class="h-control"
				disabled={busy || unsettled || (kept && !anythingToKeep)}
				onclick={() => (keeping = true)}
			>
				Keep this version
			</Button>
		</section>

		{#if elsewhere}
			<section class="space-y-3 border-t border-border pt-6">
				<h3 class="text-sm font-medium">Where else your notes are</h3>
				{@render elsewhere()}
			</section>
		{/if}

		<section class="space-y-2 border-t border-border pt-6">
			<h3 class="text-sm font-medium">Versions</h3>
			{#if !(anyKept ?? kept)}
				<p class="text-sm text-muted-foreground">You have not kept one yet.</p>
			{:else if picture}
				{@render picture()}
			{:else}
				<ul class="space-y-1">
					{#each versions as version (version.id)}
						<li>
							{#if onOpenVersion}
								<button
									type="button"
									class="w-full rounded-md px-2 py-2 text-left hover:bg-muted"
									onclick={() => onOpenVersion(version.id)}
								>
									<span class="block truncate text-sm">{version.message || 'A version'}</span>
									<span class="block truncate text-xs text-muted-foreground">
										{version.when}{version.author ? ` · ${version.author}` : ''}{version.merged
											? ' · brought a line in'
											: ''}
									</span>
								</button>
							{:else}
								<div class="px-2 py-2">
									<span class="block truncate text-sm">{version.message || 'A version'}</span>
									<span class="block truncate text-xs text-muted-foreground">
										{version.when}{version.author ? ` · ${version.author}` : ''}
									</span>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				{#if onOpenVersion}
					<p class="px-2 text-xs text-muted-foreground">
						Open one to read your graph as it was. Nothing there can be written in.
					</p>
				{/if}
				{#if older}
					<Button variant="ghost" class="h-9 w-full rounded-full" disabled={busy} onclick={onOlder}>
						Older versions
					</Button>
				{/if}
			{/if}
		</section>

		<section class="space-y-3 border-t border-border pt-6">
			<h3 class="text-sm font-medium">Lines of work</h3>
			{#if branches}
				{@render branches()}
			{:else}
				<p class="text-sm text-muted-foreground">
					A line of your own to try something on, and the way to bring it back in when it works.
				</p>
				<ul class="space-y-1">
					{#each lines as one (one.name)}
						<li class="flex items-center gap-2">
							<span class="w-4 shrink-0 text-muted-foreground">
								{#if one.here}<Check class="size-4" aria-hidden="true" />{/if}
							</span>
							<span class="min-w-0 flex-1 truncate text-sm">{one.name}</span>
							{#if !one.here}
								<Button
									variant="ghost"
									class="h-9 shrink-0 rounded-full text-xs"
									disabled={busy}
									onclick={() => void moveLine(() => onWorkOn(one.name))}
								>
									Work on it
								</Button>
								<Button
									variant="outline"
									class="h-9 shrink-0 rounded-full text-xs"
									disabled={busy || unsettled}
									onclick={() => void moveLine(() => onBringIn(one.name))}
								>
									Bring it in
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
				<div class="flex gap-2">
					<Input
						bind:value={naming}
						class="h-control flex-1"
						autocomplete="off"
						maxlength={128}
						placeholder="another-way"
						aria-label="Name a new line of work"
						onkeydown={(e) => {
							if (e.key !== 'Enter') return;
							e.preventDefault();
							void startLine();
						}}
					/>
					<Button
						variant="outline"
						class="h-control shrink-0"
						disabled={busy || !kept || naming.trim() === ''}
						onclick={startLine}
					>
						Start it here
					</Button>
				</div>
				{#if !kept}
					<p class="text-xs text-muted-foreground">
						Keep a version first, and a line can start from it.
					</p>
				{/if}
			{/if}
		</section>

		<section class="space-y-3 border-t border-border pt-6">
			<h3 class="text-sm font-medium">What is different</h3>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div class="flex-1 space-y-1">
					<span class="text-xs text-muted-foreground" id="difference-from">From</span>
					<Select.Root type="single" bind:value={before}>
						<Select.Trigger class="h-control w-full" aria-labelledby="difference-from">
							{labelled(before)}
						</Select.Trigger>
						<Select.Content>
							{#each states as state (state.value)}
								<Select.Item value={state.value} class="min-h-control">{state.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex-1 space-y-1">
					<span class="text-xs text-muted-foreground" id="difference-to">To</span>
					<Select.Root type="single" bind:value={after}>
						<Select.Trigger class="h-control w-full" aria-labelledby="difference-to">
							{labelled(after)}
						</Select.Trigger>
						<Select.Content>
							{#each states as state (state.value)}
								<Select.Item value={state.value} class="min-h-control">{state.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<Button
					variant="outline"
					class="h-control shrink-0"
					disabled={comparing || before === after}
					onclick={compare}
				>
					Show what changed
				</Button>
			</div>
			{#if compared}
				<ChangedNotes
					notes={compared.notes}
					pictures={compared.pictures}
					nothing="These two are the same."
				/>
			{/if}
		</section>

		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>

<ResponsiveModal
	bind:open={keeping}
	title="Keep this version"
	description="Say what changed, so it reads as something later."
>
	<div class="space-y-3 px-2 pt-4 pb-2">
		<Input
			bind:value={message}
			class="h-control"
			autocomplete="off"
			maxlength={512}
			placeholder="Where the argument turned"
			aria-label="What changed"
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				void keep();
			}}
		/>
		<Button class="h-control w-full" disabled={busy || message.trim() === ''} onclick={keep}>
			Keep it
		</Button>
		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
