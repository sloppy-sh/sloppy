<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { PersonChip } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { api } from '../api.js';
	import HistorySettings from '../components/history-settings.svelte';
	import IdentitySettings from '../components/identity-settings.svelte';
	import { repointRuntime, runtime } from '../runtime.js';
	import { saveHere, savesFiles } from '../save-file.js';
	import { serverMessage } from '../stores/errors.js';
	import { conversation } from '../stores/conversation.svelte.js';
	import { deleted } from '../stores/deleted.svelte.js';
	import { find } from '../stores/find.svelte.js';
	import { gitSettings } from '../stores/git-settings.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { identity } from '../stores/identity.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { offers } from '../stores/offers.svelte.js';
	import { outlineSections } from '../stores/outline-sections.svelte.js';
	import { peers } from '../stores/peers.svelte.js';
	import { people, personFrom } from '../stores/people.svelte.js';
	import {
		ACCENT_LABELS,
		ACCENTS,
		asOrigin,
		FONT_LABELS,
		FONTS,
		prefs,
		STYLE_LABELS,
		STYLES,
		THEME_LABELS,
		THEMES
	} from '../stores/prefs.svelte.js';
	import { publications } from '../stores/publications.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import { tags } from '../stores/tags.svelte.js';
	import HistorySurface from './history.svelte';

	const vault = runtime.vault();

	let leaving = $state(false);
	let showingHistory = $state(false);
	let opening = $state(false);
	let folder = $state(vault?.folder());
	let folderProblem = $state<string | null>(null);
	let copying = $state(false);
	let copyProblem = $state<string | null>(null);
	let typedOrigin = $state(prefs.current.origin ?? '');
	let originProblem = $state<string | null>(null);
	let moved = $state<string | null>(null);

	const canSaveFiles = savesFiles();
	const offersCopy = $derived(session.onDevice ? canSaveFiles : session.signedIn);

	/** Where a person's identity is kept for them. A graph on this device is
	 *  written under one this device made, and there is nowhere else it is. */
	const instance = $derived(
		session.viewer && !session.onDevice ? new URL(session.viewer.syr_instance_url).host : null
	);
	const profile = $derived(people.me);

	$effect(() => {
		if (session.signedIn && !session.onDevice && !people.me) void people.read().catch(() => {});
	});

	async function takeCopy() {
		copying = true;
		copyProblem = null;
		try {
			const held = await api.exportEverything();
			const name = `sloppy-${held.exported_at.slice(0, 10)}.json`;
			const body = new Blob([JSON.stringify(held)], { type: 'application/json' });
			await saveHere(name, body);
		} catch (error) {
			copyProblem =
				serverMessage(error) ??
				'Sloppy could not put your copy together just now. Try again in a moment.';
		} finally {
			copying = false;
		}
	}

	async function openAnother() {
		if (!vault) return;
		opening = true;
		folderProblem = null;
		try {
			const chosen = await vault.open();
			if (!chosen) return;
			folder = chosen;
			letGoOfWhatWasRead();
			await graphs.readOpenFolder(true);
		} catch (error) {
			folderProblem =
				typeof error === 'string' && error.trim()
					? error
					: 'Sloppy could not open that folder. Try another one.';
		} finally {
			opening = false;
		}
	}

	async function signOut() {
		leaving = true;
		try {
			await session.signOut();
		} finally {
			letGoOfWhatWasRead();
			leaving = false;
		}
	}

	function letGoOfWhatWasRead() {
		graphHistory.clear();
		gitSettings.clear();
		nodes.clear();
		offers.clear();
		outlineSections.clear();
		deleted.clear();
		graphs.clear();
		tags.clear();
		peers.clear();
		find.clear();
		people.hold(null);
		publications.clear();
		conversation.clear();
		identity.clear();
	}

	/** Null returns to the Sloppy the app came with. */
	function pointAt(origin: string | null) {
		typedOrigin = origin ?? '';
		originProblem = null;
		if (origin === prefs.current.origin) {
			moved = origin
				? `Sloppy is already at ${new URL(origin).host}.`
				: 'Sloppy is already where it came from.';
			return;
		}
		prefs.set('origin', origin);
		repointRuntime();
		session.clear();
		letGoOfWhatWasRead();
		moved = origin
			? `Sloppy is at ${new URL(origin).host} now. Sign in there to carry on.`
			: 'Sloppy is back where it came from. Sign in to carry on.';
	}

	function pointHere(event: SubmitEvent) {
		event.preventDefault();
		const typed = typedOrigin.trim();
		if (typed === '') {
			moved = null;
			originProblem = 'Type the web address of your Sloppy, like sloppy.example.com.';
			return;
		}
		const origin = asOrigin(typed);
		if (!origin) {
			moved = null;
			originProblem =
				"That doesn't look like a web address. Try something like sloppy.example.com.";
			return;
		}
		pointAt(origin);
	}
</script>

{#snippet choice(group: string, value: string, label: string, chosen: boolean, choose: () => void)}
	<label class="cursor-pointer">
		<input
			type="radio"
			name={group}
			{value}
			checked={chosen}
			onchange={choose}
			class="peer sr-only"
		/>
		<span
			class="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm text-muted-foreground transition-colors duration-150 ease-out peer-checked:border-primary peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none"
		>
			{label}
		</span>
	</label>
{/snippet}

<svelte:head><title>Settings · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-10 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 sm:px-8"
	>
		<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>

		<fieldset class="space-y-3">
			<legend class="text-sm font-medium">Theme</legend>
			<div class="flex flex-wrap gap-2">
				{#each THEMES as theme (theme)}
					{@render choice('theme', theme, THEME_LABELS[theme], prefs.current.theme === theme, () =>
						prefs.set('theme', theme)
					)}
				{/each}
			</div>
		</fieldset>

		<fieldset class="space-y-3">
			<legend class="text-sm font-medium">Accent</legend>
			<div class="flex flex-wrap gap-2">
				{#each ACCENTS as accent (accent)}
					{@render choice(
						'accent',
						accent,
						ACCENT_LABELS[accent],
						prefs.current.accent === accent,
						() => prefs.set('accent', accent)
					)}
				{/each}
			</div>
		</fieldset>

		<fieldset class="space-y-3">
			<legend class="text-sm font-medium">Style</legend>
			<div class="flex flex-wrap gap-2">
				{#each STYLES as style (style)}
					{@render choice('style', style, STYLE_LABELS[style], prefs.current.style === style, () =>
						prefs.set('style', style)
					)}
				{/each}
			</div>
		</fieldset>

		<fieldset class="space-y-3">
			<legend class="text-sm font-medium">Font</legend>
			<div class="flex flex-wrap gap-2">
				{#each FONTS as font (font)}
					{@render choice('font', font, FONT_LABELS[font], prefs.current.font === font, () =>
						prefs.set('font', font)
					)}
				{/each}
			</div>
		</fieldset>

		{#if session.onDevice}
			<div class="space-y-3 border-t border-border pt-8">
				<h2 class="text-sm font-medium">Where your writing is</h2>
				<p class="text-sm text-muted-foreground">
					Your graph is a folder on this device, and everything you write stays in it. Publishing a
					branch, reading somebody else's and answering a note need a Sloppy other people can reach,
					so they are not offered here.
				</p>
				{#if vault?.asks}
					{#if folder}
						<p class="text-sm break-all text-foreground select-text">{folder}</p>
					{/if}
					<p class="text-sm text-muted-foreground">
						Open another folder and the graph in it is the one in front of you. An empty one starts
						a graph of its own; either way, what is in this folder stays in it.
					</p>
					<Button
						variant="outline"
						class="h-11"
						disabled={opening}
						aria-busy={opening}
						onclick={() => void openAnother()}
					>
						{opening ? 'One moment…' : 'Open another folder'}
					</Button>
					{#if folderProblem}
						<p class="text-sm text-destructive" role="alert">{folderProblem}</p>
					{/if}
				{/if}
			</div>

			{#if runtime.identities()}
				<div class="space-y-3 border-t border-border pt-8">
					<h2 class="text-sm font-medium">Who you write as</h2>
					<IdentitySettings />
				</div>
			{/if}

			{#if graphHistory.keeps}
				<div class="space-y-3 border-t border-border pt-8">
					<h2 class="text-sm font-medium">History</h2>
					<p class="text-sm text-muted-foreground">
						Keep a version of your graph whenever it is worth coming back to, and see what has
						changed since the last one. A line of your own is where you try something without
						touching the graph you have.
					</p>
					<Button variant="outline" class="h-11" onclick={() => (showingHistory = true)}>
						Open the history
					</Button>
					<HistorySettings />
				</div>
			{/if}
		{:else}
			<div class="space-y-3 border-t border-border pt-8">
				<h2 class="text-sm font-medium">Where your Sloppy is</h2>
				<p class="text-sm text-muted-foreground">
					Your writing lives wherever Sloppy is. Give the web address of one you run yourself and
					Sloppy reads and writes there from now on — you'll be signed out here, and can sign in
					there. What you have already written stays on the Sloppy that holds it.
				</p>
				<form class="flex flex-col gap-2 sm:flex-row" onsubmit={pointHere}>
					<Label for="sloppy-origin" class="sr-only">The web address of your Sloppy</Label>
					<Input
						id="sloppy-origin"
						name="origin"
						type="text"
						inputmode="url"
						autocomplete="url"
						autocapitalize="none"
						spellcheck={false}
						placeholder="sloppy.example.com"
						bind:value={typedOrigin}
						class="h-11 sm:flex-1"
					/>
					<Button type="submit" variant="outline" class="h-11">Point Sloppy here</Button>
				</form>
				{#if originProblem}
					<p class="text-sm text-destructive" role="alert">{originProblem}</p>
				{/if}
				{#if moved}
					<p class="text-sm text-muted-foreground" role="status">{moved}</p>
				{/if}
				{#if prefs.current.origin}
					<Button variant="ghost" class="h-11 px-0" onclick={() => pointAt(null)}>
						Use the one Sloppy came with
					</Button>
				{/if}
			</div>
		{/if}

		{#if offersCopy}
			<div class="space-y-3 border-t border-border pt-8">
				<h2 class="text-sm font-medium">Your writing</h2>
				<p class="text-sm text-muted-foreground">
					A copy of everything you have written — every graph, every note, and every section of them
					— in one file that is yours to keep. It holds what you have saved; writing still waiting
					on this device isn't in it yet.
				</p>
				<Button
					variant="outline"
					onclick={takeCopy}
					disabled={copying || !canSaveFiles}
					class="h-11"
				>
					{copying ? 'Putting it together…' : 'Download a copy'}
				</Button>
				{#if !canSaveFiles}
					<p class="text-sm text-muted-foreground">
						Taking a copy isn't available here yet. Open Sloppy in a browser to take one.
					</p>
				{/if}
				{#if copyProblem}
					<p class="text-sm text-destructive" role="alert">{copyProblem}</p>
				{/if}
			</div>
		{/if}

		{#if !session.onDevice}
			<div class="space-y-3 border-t border-border pt-8">
				{#if session.signedIn}
					{#if profile}
						<a
							href="/profile"
							class="-mx-2 flex min-h-14 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors duration-150 ease-out hover:bg-muted/70 motion-reduce:transition-none"
						>
							<PersonChip person={personFrom(profile)} />
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</a>
					{/if}
					<p class="text-sm text-muted-foreground">
						Your identity lives at <span class="text-foreground select-text">{instance}</span>.
					</p>
					<Button variant="ghost" onclick={signOut} disabled={leaving} class="h-11 px-0">
						Sign out
					</Button>
				{:else}
					<p class="text-sm text-muted-foreground">Your graph opens once you sign in.</p>
					<a
						href="/sign-in"
						class="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
					>
						Sign in
					</a>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if graphHistory.keeps}
	<HistorySurface bind:open={showingHistory} />
{/if}
