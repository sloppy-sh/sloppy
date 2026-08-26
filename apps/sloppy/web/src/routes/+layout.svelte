<script lang="ts">
	import '@fontsource-variable/inter/index.css';
	import '@fontsource-variable/jetbrains-mono/index.css';
	import '../app.css';
	import { initRuntime } from '@sloppy/app-core';

	let { children } = $props();

	// The platform seam, before any page mounts. Every member left out is a
	// choice; `runtime.ts` in @sloppy/app-core states what each absence decides.
	initRuntime({ apiHost: () => import.meta.env.PUBLIC_SLOPPY_API_URL ?? '' });
</script>

{@render children()}
