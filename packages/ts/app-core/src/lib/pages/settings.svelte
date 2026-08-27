<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '@sloppy/ui/button';
	import { labels } from '../stores/labels.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import {
		ACCENT_LABELS,
		ACCENTS,
		prefs,
		STYLE_LABELS,
		STYLES,
		THEME_LABELS,
		THEMES
	} from '../stores/prefs.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let leaving = $state(false);

	const instance = $derived(session.viewer ? new URL(session.viewer.syr_instance_url).host : null);

	async function signOut() {
		leaving = true;
		await session.signOut();
		nodes.clear();
		labels.clear();
		leaving = false;
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
		<div class="space-y-6">
			<a
				href="/"
				class="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
			>
				<ArrowLeft class="size-4" />
				Graph
			</a>
			<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
		</div>

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

		<div class="space-y-3 border-t border-border pt-8">
			{#if session.signedIn}
				<p class="text-sm text-muted-foreground">
					Signed in at <span class="text-foreground select-text">{instance}</span>.
				</p>
				<Button variant="ghost" onclick={signOut} disabled={leaving} class="h-11 px-0">
					Sign out
				</Button>
			{:else}
				<p class="text-sm text-muted-foreground">You are not signed in.</p>
				<a
					href="/sign-in"
					class="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
				>
					Sign in
				</a>
			{/if}
		</div>
	</div>
</div>
