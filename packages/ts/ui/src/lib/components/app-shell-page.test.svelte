<script lang="ts">
	// A stand-in page for the shell suite: it reports every mount, which is how
	// "rendered in exactly one place" is measured rather than asserted.
	import { onMount } from 'svelte';

	let { onmount }: { onmount: () => void } = $props();

	onMount(() => onmount());
</script>

<p data-testid="page">the graph</p>
