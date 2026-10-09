<script lang="ts">
	// The settings page inside the chrome, so a suite sees the contents it fills
	// the desk column with as well as the page itself. No destinations: a suite
	// about settings is not a suite about where else to go.
	import { AppShell } from '@sloppy/ui';
	import { prefs } from '../stores/prefs.svelte.js';
	import Settings from './settings.svelte';
</script>

<AppShell
	deskNavOpen={prefs.current.deskNavOpen}
	onDeskNavOpenChange={(open) => prefs.set('deskNavOpen', open)}
>
	<Settings />
</AppShell>
