<script lang="ts">
	// The choices behind the strip's +: a graph of its own, a project, a folder,
	// and where somebody has been writing — DESIGN.md § Layout.
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { runtime } from '../runtime.js';
	import { wordsFor } from '../stores/errors.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { tabs } from '../stores/tabs.svelte.js';
	import KnownFolders from './known-folders.svelte';

	let {
		onDone
	}: {
		/** A folder is in front of somebody now, or they chose none: either way
		 *  the choices go. */
		onDone: () => void;
	} = $props();

	let name = $state('');
	let opening = $state<'here' | 'project' | 'folder' | 'known' | null>(null);
	let openingFolder = $state<string | null>(null);
	let problem = $state<string | null>(null);

	/** The folders somebody has written in, the one in front of them left out:
	 *  it is already open, and the row would open nothing. */
	const inFront = $derived(tabs.active ?? graphs.openFolder ?? runtime.vault()?.folder());
	const elsewhere = $derived(graphs.folders.filter((one) => one.root !== inFront));

	$effect(() => {
		void graphs.readFolders();
	});

	async function through(
		what: typeof opening,
		act: () => Promise<boolean>,
		otherwise: string
	): Promise<void> {
		opening = what;
		problem = null;
		try {
			if (await act()) onDone();
		} catch (error) {
			problem = wordsFor(error) ?? otherwise;
		} finally {
			opening = null;
			openingFolder = null;
		}
	}

	function startHere(): Promise<void> {
		const title = name.trim();
		return through(
			'here',
			async () => {
				if (!(await tabs.openWith(() => graphs.startHere()))) return false;
				if (title !== '') await graphs.rename(graphs.home, { title });
				return true;
			},
			'Sloppy could not make a place for a graph on this device.'
		);
	}

	function openKnown(root: string): Promise<void> {
		openingFolder = root;
		return through(
			'known',
			async () => {
				await tabs.switchTo(root);
				return true;
			},
			'That folder could not be opened.'
		);
	}
</script>

<div class="flex flex-col gap-6 px-2 pt-4 pb-2">
	{#if graphs.startsHere}
		<form
			class="space-y-2"
			onsubmit={(event) => {
				event.preventDefault();
				void startHere();
			}}
		>
			<p class="text-sm">A graph of its own, kept by Sloppy on this device.</p>
			<div class="flex gap-2">
				<Input
					bind:value={name}
					class="h-control min-w-0 flex-1 text-sm"
					aria-label="What the graph is called"
					placeholder="What it is called (you can name it later)"
					disabled={opening !== null}
				/>
				<Button
					type="submit"
					class="h-control shrink-0"
					disabled={opening !== null}
					aria-busy={opening === 'here'}
				>
					{opening === 'here' ? 'One moment…' : 'Start a graph'}
				</Button>
			</div>
		</form>
	{/if}

	<div class="space-y-2">
		{#if graphs.opensProjects}
			<p class="text-xs text-muted-foreground">
				Notes that sit with the code they are about. Choose the project's own folder.
			</p>
			<Button
				type="button"
				variant="outline"
				class="h-control w-full"
				disabled={opening !== null}
				aria-busy={opening === 'project'}
				onclick={() =>
					void through(
						'project',
						() => tabs.openWith(() => graphs.openProject()),
						'That project could not be opened.'
					)}
			>
				{opening === 'project' ? 'One moment…' : 'Open a project'}
			</Button>
		{/if}
		{#if graphs.keepsFolders}
			<p class="text-xs text-muted-foreground">
				A folder of your choosing: an empty one becomes a graph, one that holds a graph opens.
			</p>
			<Button
				type="button"
				variant="outline"
				class="h-control w-full"
				disabled={opening !== null}
				aria-busy={opening === 'folder'}
				onclick={() =>
					void through(
						'folder',
						() => tabs.openWith(() => graphs.startFolder()),
						'That folder could not be opened.'
					)}
			>
				{opening === 'folder' ? 'One moment…' : 'Choose a folder'}
			</Button>
		{/if}
	</div>

	{#if problem}
		<p class="text-sm text-destructive" role="alert">{problem}</p>
	{/if}

	{#if elsewhere.length > 0}
		<div class="space-y-3">
			<h3 class="px-2 text-sm font-medium">Where you've been writing</h3>
			<KnownFolders
				folders={elsewhere}
				opening={openingFolder}
				busy={opening !== null}
				onopen={(root) => void openKnown(root)}
			/>
		</div>
	{/if}
</div>
