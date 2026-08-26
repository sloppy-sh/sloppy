<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ACCENTS,
		STYLES,
		THEMES,
		prefs,
		type Accent,
		type Style,
		type Theme
	} from '$lib/prefs.svelte';

	const THEME_LABELS: Record<Theme, string> = {
		paper: 'Paper',
		graphite: 'Graphite',
		light: 'Light',
		dark: 'Dark',
		contrast: 'High contrast'
	};
	const ACCENT_LABELS: Record<Accent, string> = {
		indigo: 'Indigo',
		moss: 'Moss',
		rust: 'Rust',
		sea: 'Sea',
		iris: 'Iris',
		ochre: 'Ochre',
		slate: 'Slate'
	};
	const STYLE_LABELS: Record<Style, string> = { default: 'Default', hardline: 'Hardline' };
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
			class="inline-flex h-11 items-center rounded-md
				border border-border
				bg-card px-4 text-sm text-muted-foreground transition-colors duration-150
				ease-out peer-checked:border-primary peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2
				peer-focus-visible:ring-offset-background"
		>
			{label}
		</span>
	</label>
{/snippet}

<svelte:head><title>Settings · Sloppy</title></svelte:head>

<div class="space-y-10">
	<div class="space-y-6">
		<a
			href={resolve('/')}
			class="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		>
			Back
		</a>
		<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
	</div>

	<fieldset class="space-y-3">
		<legend class="text-sm font-medium">Theme</legend>
		<div class="flex flex-wrap gap-2">
			{#each THEMES as theme (theme)}
				{@render choice('theme', theme, THEME_LABELS[theme], prefs.theme === theme, () =>
					prefs.set({ theme })
				)}
			{/each}
		</div>
	</fieldset>

	<fieldset class="space-y-3">
		<legend class="text-sm font-medium">Accent</legend>
		<div class="flex flex-wrap gap-2">
			{#each ACCENTS as accent (accent)}
				{@render choice('accent', accent, ACCENT_LABELS[accent], prefs.accent === accent, () =>
					prefs.set({ accent })
				)}
			{/each}
		</div>
	</fieldset>

	<fieldset class="space-y-3">
		<legend class="text-sm font-medium">Style</legend>
		<div class="flex flex-wrap gap-2">
			{#each STYLES as style (style)}
				{@render choice('style', style, STYLE_LABELS[style], prefs.style === style, () =>
					prefs.set({ style })
				)}
			{/each}
		</div>
	</fieldset>
</div>
