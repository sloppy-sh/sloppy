<script lang="ts">
	import '../app.css';

	let { children } = $props();

	const TITLE = "Sloppy: coding agents that work from your team's decisions";
	const DESCRIPTION =
		'Sloppy is an open-source knowledge graph of why a codebase is the way it is. Your team owns and reviews it; Claude Code, Codex and any MCP-capable agent read it before they write.';
</script>

<svelte:head>
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESCRIPTION} />
</svelte:head>

{@render children()}
