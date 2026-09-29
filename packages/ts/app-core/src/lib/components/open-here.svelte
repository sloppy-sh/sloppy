<script lang="ts">
	// The two ways a graph kept on this device is opened, and what is true while
	// one is — docs/ARCHITECTURE.md § "A graph on this device, beside the one a
	// Sloppy serves".
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { graphHere } from '../graph-here.svelte.js';
	import { savesFiles } from '../save-file.js';
	import { wordsFor } from '../stores/errors.js';

	let {
		/** A sheet somebody opened to change which graph they are in: the offer,
		 *  and not the account of what is true while one is open. Settings is
		 *  where that is said. */
		brief = false
	}: { brief?: boolean } = $props();

	const WAYS_OUT = {
		close: { answer: 'Close it', act: () => graphHere.close() },
		folder: { answer: 'Open a folder', act: () => graphHere.openFolder() },
		archive: { answer: 'Open an archive', act: () => graphHere.openArchive() }
	} as const;
	type WayOut = keyof typeof WAYS_OUT;

	let working = $state<WayOut | 'copy' | 'again' | null>(null);
	let problem = $state<string | null>(null);
	let asking = $state<WayOut | null>(null);

	const open = $derived(graphHere.open);
	const waiting = $derived(graphHere.waiting);
	const canSaveFiles = savesFiles();
	const question = $derived(asking === null ? null : { way: asking, ...WAYS_OUT[asking] });

	/** An archive's writing is in Sloppy and nowhere else, so every way out of
	 *  one asks first. */
	function leave(way: WayOut): void {
		if (open?.how === 'archive') asking = way;
		else void doing(way, WAYS_OUT[way].act);
	}

	async function answered(way: WayOut): Promise<void> {
		asking = null;
		await doing(way, WAYS_OUT[way].act);
	}

	async function doing(what: NonNullable<typeof working>, act: () => Promise<unknown>) {
		working = what;
		problem = null;
		try {
			await act();
		} catch (error) {
			problem = wordsFor(error) ?? 'That did not work. Try again.';
		} finally {
			working = null;
		}
	}
</script>

{#if open}
	{#if brief}
		<h3 class="text-sm font-medium">The graph in front of you</h3>
	{:else}
		<h2 class="text-sm font-medium">Where your writing is</h2>
	{/if}
	<p class="text-sm text-muted-foreground">
		{#if open.how === 'folder'}
			<span class="text-foreground select-text">{open.name}</span> is open. Everything you write goes
			straight into it, and nothing in it is sent anywhere.
		{:else}
			<span class="text-foreground select-text">{open.name}</span> is open. What you write stays in Sloppy
			until you save a copy, and nothing in it is sent anywhere. The file you opened is untouched.
		{/if}
	</p>
	{#if !brief}
		<p class="text-sm text-muted-foreground">
			{#if open.ownIdentity}
				You're writing as the identity Sloppy made here, not an account. Signing in waits until you
				close this graph.
			{:else}
				You're writing as the account you are signed in with. Signing out waits until you close this
				graph.
			{/if}
		</p>
		<p class="text-sm text-muted-foreground">
			Publishing a branch, reading somebody else's and answering a note need a Sloppy other people
			can reach, so they are not offered while this graph is open. Starting another graph and
			bringing one in from a file wait until you close it.
			{#if open.how === 'folder'}
				Keeping versions of a folder as you go is the desktop app's to do.
			{/if}
		</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#if open.how === 'archive'}
			<Button
				variant="outline"
				class="h-control"
				disabled={working !== null || !canSaveFiles}
				aria-busy={working === 'copy'}
				onclick={() => void doing('copy', () => graphHere.saveCopy())}
			>
				{working === 'copy' ? 'Putting it together…' : 'Save a copy'}
			</Button>
		{/if}
		{#if graphHere.opensAFolder}
			<Button
				variant="outline"
				class="h-control"
				disabled={working !== null}
				aria-busy={working === 'folder'}
				onclick={() => leave('folder')}
			>
				{working === 'folder' ? 'One moment…' : 'Open a folder instead'}
			</Button>
		{/if}
		<Button
			variant="outline"
			class="h-control"
			disabled={working !== null}
			aria-busy={working === 'archive'}
			onclick={() => leave('archive')}
		>
			{working === 'archive' ? 'One moment…' : 'Open an archive instead'}
		</Button>
		<Button
			variant="ghost"
			class="h-control"
			disabled={working !== null}
			aria-busy={working === 'close'}
			onclick={() => leave('close')}
		>
			Close
		</Button>
	</div>
{:else}
	{#if brief}
		<h3 class="text-sm font-medium">A graph kept on this device</h3>
	{:else}
		<h2 class="text-sm font-medium">A graph kept on this device</h2>
	{/if}
	{#if waiting}
		<p class="text-sm text-muted-foreground">
			<span class="text-foreground select-text">{waiting}</span> was open here last. Your browser asks
			again before Sloppy can read it. Nothing in it is sent anywhere.
		</p>
		<div class="flex flex-col gap-2 sm:flex-row">
			<Button
				class="h-control sm:flex-1"
				disabled={working !== null}
				aria-busy={working === 'again'}
				onclick={() => void doing('again', () => graphHere.openAgain())}
			>
				<FolderOpen class="size-4" />
				{working === 'again' ? 'One moment…' : 'Open it again'}
			</Button>
			<Button
				variant="ghost"
				class="h-control"
				disabled={working !== null}
				onclick={() => graphHere.notNow()}
			>
				Not now
			</Button>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			{#if graphHere.startsAGraph}
				Open a folder on this device and keep your writing in it. A folder with nothing in it yet
				becomes a graph of your own. Nothing in it is sent anywhere.
			{:else}
				Open a graph you keep on this device and read and write it here. Nothing in it is sent
				anywhere.
			{/if}
		</p>
	{/if}
	<div class="flex flex-col gap-2 sm:flex-row">
		{#if graphHere.opensAFolder}
			<Button
				variant="outline"
				class="h-control sm:flex-1"
				disabled={working !== null}
				aria-busy={working === 'folder'}
				onclick={() => leave('folder')}
			>
				<FolderOpen class="size-4" />
				{working === 'folder' ? 'One moment…' : 'Open a folder on this device'}
			</Button>
		{/if}
		<Button
			variant="outline"
			class="h-control sm:flex-1"
			disabled={working !== null}
			aria-busy={working === 'archive'}
			onclick={() => leave('archive')}
		>
			<FileArchive class="size-4" />
			{working === 'archive' ? 'One moment…' : 'Open an archive'}
		</Button>
	</div>
{/if}

{#if problem && question === null}
	<p class="text-sm text-destructive" role="alert">{problem}</p>
{/if}

<ResponsiveModal
	open={question !== null}
	onOpenChange={(up) => {
		if (!up) asking = null;
	}}
	title="Leave this graph?"
	description="What you have written since you opened it is not in the file yet. Save a copy first to keep it."
>
	{#if question}
		<div class="flex flex-col gap-3 px-2 pt-4">
			{#if problem}
				<p class="text-sm text-destructive" role="alert">{problem}</p>
			{/if}
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="outline"
					class="h-control sm:h-9"
					disabled={working !== null}
					onclick={() => (asking = null)}
				>
					Cancel
				</Button>
				<Button
					variant="outline"
					class="h-control sm:h-9"
					disabled={working !== null || !canSaveFiles}
					aria-busy={working === 'copy'}
					onclick={() => void doing('copy', () => graphHere.saveCopy())}
				>
					{working === 'copy' ? 'Putting it together…' : 'Save a copy'}
				</Button>
				<Button
					class="h-control sm:h-9"
					disabled={working !== null}
					onclick={() => void answered(question.way)}
				>
					{question.answer}
				</Button>
			</div>
		</div>
	{/if}
</ResponsiveModal>
