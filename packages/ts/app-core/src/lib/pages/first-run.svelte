<script lang="ts">
	import type { IdentityHere } from '@sloppy/local';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '@sloppy/ui/button';
	import IdentitySettings from '../components/identity-settings.svelte';
	import KnownFolders from '../components/known-folders.svelte';
	import { runtime, type KnownFolder } from '../runtime.js';
	import { session } from '../stores/session.svelte.js';

	let {
		onopened,
		/** Somebody whose folder is no longer where they put it, rather than
		 *  somebody who has never had one. */
		missing = false
	}: { onopened: (folder: string) => void; missing?: boolean } = $props();

	const vault = runtime.vault();
	const identities = runtime.identities();
	const openProject = vault?.openProject?.bind(vault);
	const knownFolders = vault?.known?.bind(vault);
	const openKnown = vault?.openKnown?.bind(vault);
	const forgetFolder = vault?.forget?.bind(vault);

	/** Which folder somebody is being asked for, so the one they pressed is the
	 *  button that says it is working. Null is nobody being asked anything. */
	let opening = $state<'folder' | 'project' | 'known' | null>(null);
	/** The row being opened, where it is one of the folders on the list. */
	let openingFolder = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let held = $state<IdentityHere[]>([]);
	let folders = $state<KnownFolder[]>([]);
	let showingWho = $state(false);
	/** Which ask the list on screen came from, so a slower one that started
	 *  first cannot write over a later answer. */
	let asked = 0;
	let counted = 0;

	const writing = $derived(held.find((one) => one.writing));
	const whoLine = $derived(
		writing === undefined
			? 'Who you write as'
			: writing.name
				? `You'll be writing as ${writing.name}`
				: `You'll be writing as the identity on this device`
	);

	$effect(() => {
		// Reading who is signed in is what makes this re-read when a sign-in lands
		// after the surface mounted, which is the ordinary case on a first run.
		void session.viewer;
		void refresh();
	});

	$effect(() => {
		void readFolders();
	});

	/** Null is a device that would not say what it holds, which is never read as
	 *  holding none — minting a second identity over one already here would
	 *  orphan every graph written under it. */
	async function refresh(): Promise<IdentityHere[] | null> {
		if (!identities) return [];
		const mine = ++asked;
		try {
			const listed = await identities.list();
			if (mine === asked) {
				held = listed;
				problem = null;
			}
			return listed;
		} catch (error) {
			if (mine === asked) problem = said(error);
			return null;
		}
	}

	async function readFolders(): Promise<void> {
		if (!knownFolders) return;
		const mine = ++counted;
		try {
			const listed = await knownFolders();
			if (mine === counted) folders = listed;
		} catch {
			// A device that will not say what it knows is offered the doors alone.
		}
	}

	/** The shell says what went wrong in words fit to show; anything else that
	 *  went wrong is not in any. */
	function shellSaid(error: unknown): string | null {
		return typeof error === 'string' && error.trim() ? error : null;
	}

	/** What to show for something that went wrong holding an identity, which
	 *  says what a person can do about it where it says anything at all. */
	function said(error: unknown): string {
		const words = shellSaid(error) ?? (error instanceof Error ? error.message : null);
		return words?.trim()
			? words
			: 'Sloppy could not read the identities on this device. Try again.';
	}

	/** Whether there is an identity here for a graph to be written under, making
	 *  one where there is none. False is a device that would not say what it
	 *  holds, and nothing is opened under that. */
	async function anIdentityHere(): Promise<boolean> {
		const listed = await refresh();
		if (listed === null) return false;
		if (identities && listed.length === 0) {
			await identities.makeOne();
			await refresh();
		}
		return true;
	}

	async function begin(where: 'folder' | 'project' = 'folder') {
		if (!vault) return;
		const ask = where === 'project' ? openProject : vault.open.bind(vault);
		if (!ask) return;
		opening = where;
		problem = null;
		try {
			if (!(await anIdentityHere())) return;
			const folder = await ask();
			if (!folder) return;
			await session.carryProfile();
			onopened(folder);
		} catch (error) {
			problem =
				shellSaid(error) ??
				(vault.asks
					? 'Sloppy could not write in that folder. Try another one.'
					: 'Sloppy could not make a place for your notes on this device.');
		} finally {
			opening = null;
		}
	}

	async function openThatOne(root: string): Promise<void> {
		if (!openKnown) return;
		opening = 'known';
		openingFolder = root;
		problem = null;
		try {
			if (!(await anIdentityHere())) return;
			await openKnown(root);
			await session.carryProfile();
			onopened(root);
		} catch (error) {
			problem = shellSaid(error) ?? 'That folder could not be opened. Try another one.';
		} finally {
			opening = null;
			openingFolder = null;
		}
	}

	async function forgetThatOne(root: string): Promise<void> {
		if (!forgetFolder) return;
		problem = null;
		try {
			await forgetFolder(root);
		} catch (error) {
			problem = shellSaid(error) ?? 'That folder could not be forgotten.';
		}
		await readFolders();
	}
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div
	class="pad-bottom-safe min-h-dvh px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] sm:px-8"
>
	<div class="mx-auto w-full max-w-md space-y-10 pb-24">
		<div class="space-y-3">
			<h1 class="text-3xl font-semibold tracking-tight">Sloppy</h1>
			<p class="text-muted-foreground">One thought, then the one it leads to.</p>
		</div>

		{#if folders.length > 0}
			<div class="space-y-3">
				<h2 class="px-2 text-sm font-medium">Where you've been writing</h2>
				<KnownFolders
					{folders}
					opening={openingFolder}
					busy={opening !== null}
					onopen={(root) => void openThatOne(root)}
					onforget={forgetFolder ? (root) => void forgetThatOne(root) : undefined}
				/>
			</div>
		{/if}

		<div class="space-y-4">
			<p class="text-balance">
				{#if missing}
					The folder your notes are in is not where it was. Open it again, or choose another one.
				{:else if folders.length > 0}
					Open another folder, or make a new one.
				{:else if vault?.asks}
					Your notes are files in a folder you choose. Pick an empty one, or make a new one along
					the way.
				{:else}
					Your notes are kept on this device.
				{/if}
			</p>
			<p class="text-sm text-muted-foreground">
				What you write stays on this device.
				{#if vault?.asks}
					The folder is yours — move it or back it up like any other.
				{/if}
			</p>

			{#if problem}
				<p class="text-sm text-destructive" role="alert">{problem}</p>
			{/if}

			<Button
				type="button"
				disabled={opening !== null}
				aria-busy={opening === 'folder'}
				class="h-11 w-full"
				onclick={() => void begin()}
			>
				{#if opening === 'folder'}
					One moment…
				{:else if vault?.asks}
					Choose a folder
				{:else}
					Start writing
				{/if}
			</Button>

			{#if openProject}
				<div class="space-y-2 pt-1">
					<p class="text-xs text-muted-foreground">
						Notes that sit with the code they are about. Choose the project's own folder.
					</p>
					<Button
						type="button"
						variant="outline"
						disabled={opening !== null}
						aria-busy={opening === 'project'}
						class="h-11 w-full"
						onclick={() => void begin('project')}
					>
						{#if opening === 'project'}
							One moment…
						{:else}
							Open a project
						{/if}
					</Button>
				</div>
			{/if}
		</div>

		{#if identities}
			<div class="border-t border-border pt-6">
				<button
					type="button"
					class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-muted"
					aria-expanded={showingWho}
					aria-controls="who-writes-here"
					onclick={() => (showingWho = !showingWho)}
				>
					<span class="min-w-0 flex-1 truncate">{whoLine}</span>
					<ChevronDown
						class="size-4 shrink-0 transition-transform {showingWho ? 'rotate-180' : ''}"
						aria-hidden="true"
					/>
				</button>
				{#if showingWho}
					<div id="who-writes-here" class="pt-4">
						<IdentitySettings mints={false} />
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
