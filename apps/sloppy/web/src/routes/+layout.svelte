<script lang="ts">
	import '../app.css';
	import { initRuntime } from '@sloppy/app-core';
	import Frame from '@sloppy/app-core/pages/frame';

	let { children } = $props();

	// The platform seam, before any page mounts. Every member left out is a
	// choice; `runtime.ts` in @sloppy/app-core states what each absence decides.
	initRuntime({ apiHost: () => import.meta.env.PUBLIC_SLOPPY_API_URL ?? '' });
</script>

<Frame>{@render children()}</Frame>
