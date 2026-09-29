<script lang="ts">
	// What a page puts in the desk sidebar — DESIGN.md § Layout. It draws
	// nothing here; `DeskNav` draws it wherever the sidebar stands.
	import { deskNav, type DeskParts } from './desk-nav.svelte.js';

	let { children, head }: { children: DeskParts; head?: DeskParts } = $props();

	$effect(() => deskNav.fills(children, head));
</script>
