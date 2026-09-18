<script lang="ts">
	// The two ways a graph kept on this device is opened in a browser tab, and
	// what is true while one is — docs/ARCHITECTURE.md § "A graph on this
	// device, in the browser".
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import { ConfirmModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { graphHere } from '../graph-here.svelte.js';
	import { savesFiles } from '../save-file.js';

	let {
		/** Where the doors are one thing among many — the picker's sheet — rather
		 *  than a surface's own section. */
		heading = true
	}: { heading?: boolean } = $props();

	let working = $state<'folder' | 'archive' | 'copy' | 'close' | null>(null);
	let problem = $state<string | null>(null);
	let leaving = $state(false);

	const open = $derived(graphHere.open);
	const canSaveFiles = savesFiles();

	/** An archive's writing is in this tab and nowhere else, so leaving it is
	 *  the one of the two that asks first. */
	function leave(): void {
		if (open?.how === 'archive') leaving = true;
		else void doing('close', () => graphHere.close());
	}

	async function doing(what: NonNullable<typeof working>, act: () => Promise<unknown>) {
		working = what;
		problem = null;
		try {
			await act();
		} catch (error) {
			problem = error instanceof Error ? error.message : 'That did not work. Try again.';
		} finally {
			working = null;
		}
	}
</script>

{#if open}
	{#if heading}
		<h2 class="text-sm font-medium">Where your writing is</h2>
	{/if}
	<p class="text-sm text-muted-foreground">
		{#if open.how === 'folder'}
			<span class="text-foreground select-text">{open.name}</span> is open. Everything you write goes
			straight into it, and nothing in it is sent anywhere.
		{:else}
			<span class="text-foreground select-text">{open.name}</span> is open. What you write stays in this
			tab until you save a copy, and nothing in it is sent anywhere. The file you opened is untouched.
		{/if}
	</p>
	<p class="text-sm text-muted-foreground">
		{#if open.ownIdentity}
			You're writing as the identity this browser made for itself. Signing in waits until you close
			this graph.
		{:else}
			You're writing as the account you are signed in with. Signing out waits until you close this
			graph.
		{/if}
	</p>
	<p class="text-sm text-muted-foreground">
		Publishing a branch, reading somebody else's and answering a note need a Sloppy other people can
		reach, so they are not offered while this graph is open.{#if open.how === 'folder'}
			Keeping versions of a folder as you go is the desktop app's to do.{/if}
	</p>

	<div class="flex flex-wrap gap-2">
		{#if open.how === 'archive'}
			<Button
				variant="outline"
				class="h-11"
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
				class="h-11"
				disabled={working !== null}
				aria-busy={working === 'folder'}
				onclick={() => void doing('folder', () => graphHere.openFolder())}
			>
				{working === 'folder' ? 'One moment…' : 'Open another folder'}
			</Button>
		{/if}
		<Button
			variant="ghost"
			class="h-11"
			disabled={working !== null}
			aria-busy={working === 'close'}
			onclick={() => leave()}
		>
			Close
		</Button>
	</div>
{:else}
	{#if heading}
		<h2 class="text-sm font-medium">A graph kept on this device</h2>
	{/if}
	<p class="text-sm text-muted-foreground">
		Open a graph you keep on this device and read and write it here. Nothing in it is sent anywhere
		— it stays on this device.
	</p>
	<div class="flex flex-col gap-2 sm:flex-row">
		{#if graphHere.opensAFolder}
			<Button
				variant="outline"
				class="h-11 sm:flex-1"
				disabled={working !== null}
				aria-busy={working === 'folder'}
				onclick={() => void doing('folder', () => graphHere.openFolder())}
			>
				<FolderOpen class="size-4" />
				{working === 'folder' ? 'One moment…' : 'Open a folder on this device'}
			</Button>
		{/if}
		<Button
			variant="outline"
			class="h-11 sm:flex-1"
			disabled={working !== null}
			aria-busy={working === 'archive'}
			onclick={() => void doing('archive', () => graphHere.openArchive())}
		>
			<FileArchive class="size-4" />
			{working === 'archive' ? 'One moment…' : 'Open an archive'}
		</Button>
	</div>
	{#if !graphHere.opensAFolder}
		<p class="text-xs text-muted-foreground">
			Opening a folder needs a browser that can hand one over. This one can open an archive.
		</p>
	{/if}
{/if}

{#if problem}
	<p class="text-sm text-destructive" role="alert">{problem}</p>
{/if}

<ConfirmModal
	bind:open={leaving}
	title="Close this graph?"
	description="What you have written since you opened it is only in this tab. Save a copy first to keep it."
	confirmLabel="Close it"
	onconfirm={() => doing('close', () => graphHere.close())}
/>
