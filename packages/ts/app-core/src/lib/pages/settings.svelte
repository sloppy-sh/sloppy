<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Download from '@lucide/svelte/icons/download';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Globe from '@lucide/svelte/icons/globe';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import Palette from '@lucide/svelte/icons/palette';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { ChoicePill, DESK_FROM_PX, DeskNavParts, PersonChip, scrollFade } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { api } from '../api.js';
	import HistorySettings from '../components/history-settings.svelte';
	import IdentitySettings from '../components/identity-settings.svelte';
	import OpenHere from '../components/open-here.svelte';
	import SchemePicker from '../components/scheme-picker.svelte';
	import AiSettings from '../components/ai-settings.svelte';
	import WhatHappened from '../components/what-happened.svelte';
	import { graphHere } from '../graph-here.svelte.js';
	import { repointRuntime, runtime } from '../runtime.js';
	import { saveHere, savesFiles } from '../save-file.js';
	import { serverMessage } from '../stores/errors.js';
	import { chat } from '../stores/chat.svelte.js';
	import { graphHistory } from '../stores/history.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';
	import { letGoOfWhatWasRead } from '../stores/let-go.js';
	import { people, personFrom } from '../stores/people.svelte.js';
	import {
		ACCENT_LABELS,
		ACCENTS,
		asOrigin,
		DENSITIES,
		DENSITY_LABELS,
		EFFECT_LABELS,
		EFFECTS,
		FONT_LABELS,
		FONTS,
		prefs,
		STYLE_LABELS,
		STYLES,
		type Theme,
		THEME_LABELS,
		THEMES
	} from '../stores/prefs.svelte.js';
	import { session } from '../stores/session.svelte.js';
	import HistorySurface from './history.svelte';
	import { navShows } from './routes.js';
	import { MediaQuery } from 'svelte/reactivity';
	import { tick } from 'svelte';

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
	// A graph opened on this device hands back its own copy, so the account's —
	// which is not of the graph being read — is not offered beside it.
	const offersCopy = $derived(
		!graphHere.open && (session.onDevice ? canSaveFiles : session.signedIn)
	);

	/** Where a person's identity is kept for them, and `null` where there is
	 *  nowhere: a graph on this device is written under one this device made,
	 *  and somebody who signed in with a key of their own keeps it themselves. */
	const instance = $derived(
		session.viewer?.syr_instance_url && !session.onDevice
			? new URL(session.viewer.syr_instance_url).host
			: null
	);
	const profile = $derived(people.me);
	/** With nobody signed in there is no nav pill under the page, and sign-in is
	 *  the only surface this one is reached from. */
	const wayOut = $derived(session.ready && !navShows());

	/** What this page holds, in the order it holds it — the contents beside it
	 *  on a desk and across its head on a phone. A section nothing shows is in
	 *  neither. */
	const sections = $derived([
		{ id: 'appearance', name: 'Appearance', icon: Palette },
		...(graphHere.open
			? [{ id: 'your-folder', name: 'Where your writing is', icon: FolderOpen }]
			: session.onDevice
				? [
						{ id: 'your-folder', name: 'Where your writing is', icon: FolderOpen },
						...(runtime.identities()
							? [{ id: 'who-you-are', name: 'Who you write as', icon: UserRound }]
							: []),
						...(graphHistory.keeps ? [{ id: 'history', name: 'History', icon: HistoryIcon }] : [])
					]
				: [
						{ id: 'your-sloppy', name: 'Where your Sloppy is', icon: Globe },
						...(graphHere.offered
							? [{ id: 'graph-here', name: 'A graph kept on this device', icon: FolderOpen }]
							: [])
					]),
		...(offersCopy ? [{ id: 'your-writing', name: 'Your writing', icon: Download }] : []),
		...(chat.reaches ? [{ id: 'an-assistant', name: 'An assistant', icon: Sparkles }] : []),
		{ id: 'what-went-wrong', name: 'When something goes wrong', icon: LifeBuoy },
		...(session.onDevice ? [] : [{ id: 'you', name: 'You', icon: UserRound }])
	]);

	let chosen = $state('appearance');
	/** The section in front of somebody: the one they chose, or the first of
	 *  them where what they chose is no longer here to stand. */
	const standing = $derived(sections.find((one) => one.id === chosen)?.id ?? sections[0].id);

	async function choose(id: string): Promise<void> {
		chosen = id;
		document.documentElement.scrollTop = 0;
		// The next tab is inside the section rather than back at the top.
		await tick();
		document.getElementById(id)?.focus({ preventScroll: true });
	}

	const desk = new MediaQuery(`(min-width: ${DESK_FROM_PX}px)`);

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

	/** A theme asked for here IS the theme, so the scheme stands down first:
	 *  `prefs.set` stands down one it holds the paint for, and a look saved as a
	 *  slug alone has none. */
	function wearTheme(theme: Theme): void {
		prefs.setScheme(null);
		prefs.set('theme', theme);
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

<svelte:head><title>Settings · Sloppy</title></svelte:head>

<div class="clear-sysnav">
	<div
		class="mx-auto w-full max-w-2xl space-y-10 px-5 pt-[max(1.5rem,calc(env(safe-area-inset-top,0px)-var(--app-chrome-top,0px)))] pb-12 sm:px-8"
	>
		<div class="space-y-3">
			{#if wayOut}
				<a
					href="/sign-in"
					class="-ml-2 inline-flex min-h-control items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					<ArrowLeft class="size-4" />
					Back
				</a>
			{/if}
			<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
		</div>

		{#if !desk.current}
			<nav
				aria-label="On this page"
				class="-mx-5 flex gap-2 overflow-x-auto scroll-fade-x px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8"
				{@attach scrollFade('x')}
			>
				{#each sections as section (section.id)}
					<button
						type="button"
						aria-current={standing === section.id ? 'page' : undefined}
						onclick={() => void choose(section.id)}
						class="flex min-h-control shrink-0 items-center rounded-full border px-3 text-sm transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none {standing ===
						section.id
							? 'border-transparent bg-muted text-foreground'
							: 'border-input text-muted-foreground hover:text-foreground'}"
					>
						{section.name}
					</button>
				{/each}
			</nav>
		{/if}

		{#if standing === 'appearance'}
			<section id="appearance" tabindex="-1" class="space-y-3">
				<h2 class="text-sm font-medium">Appearance</h2>
				<div class="space-y-10">
					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">Theme</legend>
						<div class="flex flex-wrap gap-2">
							{#each THEMES as theme (theme)}
								<ChoicePill
									group="theme"
									value={theme}
									label={THEME_LABELS[theme]}
									checked={prefs.current.scheme === null && prefs.current.theme === theme}
									onpick={() => wearTheme(theme)}
								/>
							{/each}
						</div>
					</fieldset>

					<SchemePicker />

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">Accent</legend>
						<div class="flex flex-wrap gap-2">
							{#each ACCENTS as accent (accent)}
								<ChoicePill
									group="accent"
									value={accent}
									label={ACCENT_LABELS[accent]}
									checked={prefs.current.accent === accent}
									onpick={() => prefs.set('accent', accent)}
								/>
							{/each}
						</div>
					</fieldset>

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">Style</legend>
						<div class="flex flex-wrap gap-2">
							{#each STYLES as style (style)}
								<ChoicePill
									group="style"
									value={style}
									label={STYLE_LABELS[style]}
									checked={prefs.current.style === style}
									onpick={() => prefs.set('style', style)}
								/>
							{/each}
						</div>
					</fieldset>

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">Font</legend>
						<div class="flex flex-wrap gap-2">
							{#each FONTS as font (font)}
								<ChoicePill
									group="font"
									value={font}
									label={FONT_LABELS[font]}
									checked={prefs.current.font === font}
									onpick={() => prefs.set('font', font)}
								/>
							{/each}
						</div>
					</fieldset>

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">How close it is drawn</legend>
						<div class="flex flex-wrap gap-2">
							{#each DENSITIES as density (density)}
								<ChoicePill
									group="density"
									value={density}
									label={DENSITY_LABELS[density]}
									checked={prefs.current.density === density}
									onpick={() => prefs.set('density', density)}
								/>
							{/each}
						</div>
						<p class="text-sm text-muted-foreground">
							Anything you tap stays big enough to tap, whatever you choose here.
						</p>
					</fieldset>

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">Screen</legend>
						<div class="flex flex-wrap gap-2">
							{#each EFFECTS as effect (effect)}
								<ChoicePill
									group="effect"
									value={effect}
									label={EFFECT_LABELS[effect]}
									checked={prefs.current.effect === effect}
									onpick={() => prefs.set('effect', effect)}
								/>
							{/each}
						</div>
					</fieldset>
				</div>
			</section>
		{/if}

		{#if graphHere.open}
			{#if standing === 'your-folder'}
				<section id="your-folder" tabindex="-1" class="space-y-3">
					<OpenHere />
				</section>
			{/if}
		{:else if session.onDevice}
			{#if standing === 'your-folder'}
				<section id="your-folder" tabindex="-1" class="space-y-3">
					<h2 class="text-sm font-medium">Where your writing is</h2>
					<p class="text-sm text-muted-foreground">
						Your graph is a folder on this device, and everything you write stays in it. Publishing
						a branch, reading somebody else's and answering a note need a Sloppy other people can
						reach, so they are not offered here.
					</p>
					{#if vault?.asks}
						{#if folder}
							<p class="text-sm break-all text-foreground select-text">{folder}</p>
						{/if}
						<p class="text-sm text-muted-foreground">
							Open another folder and the graph in it is the one in front of you. An empty one
							starts a graph of its own; either way, what is in this folder stays in it.
						</p>
						<Button
							variant="outline"
							class="h-control"
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
				</section>
			{/if}

			{#if runtime.identities()}
				{#if standing === 'who-you-are'}
					<section id="who-you-are" tabindex="-1" class="space-y-3">
						<h2 class="text-sm font-medium">Who you write as</h2>
						<IdentitySettings />
					</section>
				{/if}
			{/if}

			{#if graphHistory.keeps}
				{#if standing === 'history'}
					<section id="history" tabindex="-1" class="space-y-3">
						<h2 class="text-sm font-medium">History</h2>
						<p class="text-sm text-muted-foreground">
							Keep a version of your graph whenever it is worth coming back to, and see what has
							changed since the last one. A line of your own is where you try something without
							touching the graph you have.
						</p>
						<Button variant="outline" class="h-control" onclick={() => (showingHistory = true)}>
							Open the history
						</Button>
						<HistorySettings />
					</section>
				{/if}
			{/if}
		{:else}
			{#if standing === 'your-sloppy'}
				<section id="your-sloppy" tabindex="-1" class="space-y-3">
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
							class="h-control sm:flex-1"
						/>
						<Button type="submit" variant="outline" class="h-control">Point Sloppy here</Button>
					</form>
					{#if originProblem}
						<p class="text-sm text-destructive" role="alert">{originProblem}</p>
					{/if}
					{#if moved}
						<p class="text-sm text-muted-foreground" role="status">{moved}</p>
					{/if}
					{#if prefs.current.origin}
						<Button variant="ghost" class="h-control px-0" onclick={() => pointAt(null)}>
							Use the one Sloppy came with
						</Button>
					{/if}
				</section>
			{/if}

			{#if graphHere.offered}
				{#if standing === 'graph-here'}
					<section id="graph-here" tabindex="-1" class="space-y-3">
						<OpenHere />
					</section>
				{/if}
			{/if}
		{/if}

		{#if offersCopy}
			{#if standing === 'your-writing'}
				<section id="your-writing" tabindex="-1" class="space-y-3">
					<h2 class="text-sm font-medium">Your writing</h2>
					<p class="text-sm text-muted-foreground">
						A copy of everything you have written — every graph, every note, and every section of
						them — in one file that is yours to keep. It holds what you have saved; writing still
						waiting on this device isn't in it yet.
					</p>
					<Button
						variant="outline"
						onclick={takeCopy}
						disabled={copying || !canSaveFiles}
						class="h-control"
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
				</section>
			{/if}
		{/if}

		{#if chat.reaches}
			{#if standing === 'an-assistant'}
				<section id="an-assistant" tabindex="-1" class="space-y-3">
					<h2 class="text-sm font-medium">An assistant</h2>
					<AiSettings />
				</section>
			{/if}
		{/if}

		{#if standing === 'what-went-wrong'}
			<section id="what-went-wrong" tabindex="-1" class="space-y-3">
				<h2 class="text-sm font-medium">When something goes wrong</h2>
				<p class="text-sm text-muted-foreground">
					Sloppy can keep a record of what it does while you use it — what you asked of it, what
					came of that, and anything that failed. Turn it on, do the thing that went wrong again,
					then hand the record to whoever is fixing it.
				</p>
				<WhatHappened />
			</section>
		{/if}

		{#if !session.onDevice}
			{#if standing === 'you'}
				<section id="you" tabindex="-1" class="space-y-3">
					<h2 class="text-sm font-medium">You</h2>
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
						{#if instance}
							<p class="text-sm text-muted-foreground">
								Your identity lives at <span class="text-foreground select-text">{instance}</span>.
							</p>
						{/if}
						<Button variant="ghost" onclick={signOut} disabled={leaving} class="h-control px-0">
							Sign out
						</Button>
					{:else}
						<p class="text-sm text-muted-foreground">Your graph opens once you sign in.</p>
						<a
							href="/sign-in"
							class="inline-flex min-h-control items-center text-sm underline-offset-4 hover:underline"
						>
							Sign in
						</a>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>

<DeskNavParts>
	{#snippet children({ collapsed }: { collapsed: boolean })}
		<nav aria-label="On this page" class="flex flex-col gap-0.5">
			{#each sections as section (section.id)}
				{@const Icon = section.icon}
				{@const here = standing === section.id}
				<button
					type="button"
					aria-label={section.name}
					aria-current={here ? 'page' : undefined}
					title={collapsed ? section.name : undefined}
					onclick={() => void choose(section.id)}
					class="flex min-h-control w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none {collapsed
						? 'justify-center'
						: ''} {here ? 'bg-muted text-foreground' : 'text-muted-foreground'}"
				>
					<Icon class="size-5 shrink-0" />
					{#if !collapsed}<span class="min-w-0 truncate">{section.name}</span>{/if}
				</button>
			{/each}
		</nav>
	{/snippet}
</DeskNavParts>

{#if graphHistory.keeps}
	<HistorySurface bind:open={showingHistory} />
{/if}
