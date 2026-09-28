<script lang="ts">
	// The graph page inside the chrome, so a suite sees the desk column the page
	// fills as well as the chrome it draws over the canvas. No destinations: a
	// suite about the graph is not a suite about where else to go.
	import { AppShell } from '@sloppy/ui';
	import { prefs } from '../stores/prefs.svelte.js';
	import Graph from './graph.svelte';
</script>

<AppShell
	deskNavOpen={prefs.current.deskNavOpen}
	onDeskNavOpenChange={(open) => prefs.set('deskNavOpen', open)}
>
	<Graph />
</AppShell>
