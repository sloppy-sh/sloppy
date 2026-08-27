<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

	let { ...restProps }: SonnerProps = $props();

	// sonner keeps its own light/dark palette behind `theme`, so it has to be
	// told which one is up. The `dark` class on <html> is where that already
	// lives (DESIGN.md § "Token architecture"); reading it keeps the prefs store
	// the only writer, where a second theme manager would not.
	let dark = $state(false);
	$effect(() => {
		const el = document.documentElement;
		const read = () => (dark = el.classList.contains('dark'));
		read();
		const observer = new MutationObserver(read);
		observer.observe(el, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});
</script>

<Sonner
	theme={dark ? 'dark' : 'light'}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
	>{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
