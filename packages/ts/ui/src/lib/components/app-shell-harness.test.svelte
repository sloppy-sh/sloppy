<script lang="ts">
	import AppShell from './app-shell.svelte';
	import Page from './app-shell-page.test.svelte';
	import DeskNavParts from './desk-nav-parts.svelte';
	import type { NavItem } from './nav-pill.svelte';

	let {
		items = [],
		showNav = true,
		deskNavOpen = true,
		onDeskNavOpenChange,
		fills = false,
		onmount = () => {}
	}: {
		items?: NavItem[];
		showNav?: boolean;
		deskNavOpen?: boolean;
		onDeskNavOpenChange?: (open: boolean) => void;
		/** Whether a page standing inside the shell puts its own parts in the
		 *  sidebar. */
		fills?: boolean;
		onmount?: () => void;
	} = $props();
</script>

<AppShell {items} {showNav} {deskNavOpen} {onDeskNavOpenChange}>
	<Page {onmount} />
	{#if fills}
		<DeskNavParts>
			{#snippet children({ collapsed }: { collapsed: boolean })}
				<p data-testid="parts">{collapsed ? 'an icon rail' : 'a column'}</p>
			{/snippet}
		</DeskNavParts>
	{/if}
</AppShell>
