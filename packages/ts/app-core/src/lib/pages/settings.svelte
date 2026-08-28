<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { PersonChip } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { nodes } from '../stores/nodes.svelte.js';
	import { people, personFrom } from '../stores/people.svelte.js';
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
	import { tags } from '../stores/tags.svelte.js';

	let leaving = $state(false);

	const instance = $derived(session.viewer ? new URL(session.viewer.syr_instance_url).host : null);
	const profile = $derived(people.me);

	$effect(() => {
		if (session.signedIn && !people.me) void people.read().catch(() => {});
	});

	async function signOut() {
		leaving = true;
		try {
			await session.signOut();
		} finally {
			nodes.clear();
			tags.clear();
			people.hold(null);
			leaving = false;
		}
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
	</div>
</div>
