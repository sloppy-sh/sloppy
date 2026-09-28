<script lang="ts">
	// The graph page inside the chrome, so a suite sees the desk column the page
	// fills as well as the chrome it draws over the canvas. No destinations: a
	// suite about the graph is not a suite about where else to go.
	import { AppShell } from '@sloppy/ui';
	import Graph from './graph.svelte';
</script>

<AppShell>
	<Graph />
</AppShell>
