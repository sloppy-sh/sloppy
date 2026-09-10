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

	/** One note two lines of work both wrote in. */
	export interface NoteInTwo {
		/** What the history calls it, which is what settles it. */
		path: string;
		title: string;
		address?: string;
		/** False where it is not a note at all, and can only be taken whole. */
		isNote: boolean;
	}
</script>

<script lang="ts">
	// Every state a person's graph has been in: what has changed since the last
	// version they kept, the versions themselves, the lines of work they stand
	// on, and what is different between any two — docs/ARCHITECTURE.md § "The
	// vault's history".
	import Check from '@lucide/svelte/icons/check';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import ChangedNotes, { type ChangedNote, type ChangedPictures } from './changed-notes.svelte';

	let {
		open = $bindable(false),
		changed,
		pictures,
		anythingToKeep = false,
		versions,
		older = false,
		lines,
		conflicts = [],
		taking = null,
		busy = false,
		says = null,
		onShow,
		onKeep,
		onOlder,
		onStartLine,
		onWorkOn,
		onBringIn,
		onSettle,
		onOpenVersion,
		onCompare
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
		/** Newest first. */
		versions: readonly KeptVersion[];
		/** Whether there are older ones than these. */
		older?: boolean;
		lines: readonly LineOfWork[];
		/** Notes a merge left in two versions; empty is a graph with none. */
		conflicts?: readonly NoteInTwo[];
		/** The line being brought in, while any of it is unsettled. */
		taking?: string | null;
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
		/** Absent where a version cannot be put on the graph from here. */
		onOpenVersion?: (id: string) => void;
		onCompare: (
			before: StatePicked,
			after: StatePicked
		) => Promise<{ notes: readonly ChangedNote[]; pictures: ChangedPictures } | null>;
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
		{#if unsettled}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">Written in on both lines</h3>
				<p class="text-sm text-muted-foreground">
					{taking
						? `You and ${taking} both wrote in these. Choose what each one says, then keep the version.`
						: 'Two lines of work both wrote in these. Choose what each one says, then keep the version.'}
				</p>
				<ul class="space-y-1">
					{#each conflicts as note (note.path)}
						<li>
							<button
								type="button"
								class="flex min-h-11 w-full items-baseline gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
								onclick={() => onSettle(note.path)}
							>
								{#if note.address}
									<span class="shrink-0 address text-xs">{note.address}</span>
								{/if}
								<span class="min-w-0 flex-1 truncate">
									{note.isNote
										? note.title || 'Untitled'
										: 'Something else your graph keeps for you'}
								</span>
								<span class="shrink-0 text-xs text-muted-foreground">Choose</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
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
				class="h-11"
				disabled={busy || unsettled || (kept && !anythingToKeep)}
				onclick={() => (keeping = true)}
			>
				Keep this version
			</Button>
		</section>

		<section class="space-y-2 border-t border-border pt-6">
			<h3 class="text-sm font-medium">Versions</h3>
			{#if versions.length === 0}
				<p class="text-sm text-muted-foreground">You have not kept one yet.</p>
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
					class="h-11 flex-1"
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
					class="h-11 shrink-0"
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
		</section>

		<section class="space-y-3 border-t border-border pt-6">
			<h3 class="text-sm font-medium">What is different</h3>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div class="flex-1 space-y-1">
					<span class="text-xs text-muted-foreground" id="difference-from">From</span>
					<Select.Root type="single" bind:value={before}>
						<Select.Trigger class="h-11 w-full" aria-labelledby="difference-from">
							{labelled(before)}
						</Select.Trigger>
						<Select.Content>
							{#each states as state (state.value)}
								<Select.Item value={state.value} class="min-h-11">{state.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex-1 space-y-1">
					<span class="text-xs text-muted-foreground" id="difference-to">To</span>
					<Select.Root type="single" bind:value={after}>
						<Select.Trigger class="h-11 w-full" aria-labelledby="difference-to">
							{labelled(after)}
						</Select.Trigger>
						<Select.Content>
							{#each states as state (state.value)}
								<Select.Item value={state.value} class="min-h-11">{state.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<Button
					variant="outline"
					class="h-11 shrink-0"
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
			class="h-11"
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
		<Button class="h-11 w-full" disabled={busy || message.trim() === ''} onclick={keep}>
			Keep it
		</Button>
		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
