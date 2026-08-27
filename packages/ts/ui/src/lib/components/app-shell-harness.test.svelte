<script lang="ts">
	import AppShell from './app-shell.svelte';
	import Page from './app-shell-page.test.svelte';
	import type { NavItem } from './nav-pill.svelte';

	let {
		items = [],
		showNav = true,
		onmount = () => {}
	}: { items?: NavItem[]; showNav?: boolean; onmount?: () => void } = $props();
</script>

<AppShell {items} {showNav}>
	<Page {onmount} />
</AppShell>
