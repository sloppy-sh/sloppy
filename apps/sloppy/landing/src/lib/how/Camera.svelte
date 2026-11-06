<script lang="ts">
	import { useNodesInitialized, useSvelteFlow, type Rect } from '@xyflow/svelte';

	let { at, motion }: { at: Rect; motion: boolean } = $props();

	const { fitBounds } = useSvelteFlow();
	const ready = useNodesInitialized();

	$effect(() => {
		if (!ready.current) return;
		fitBounds(at, { padding: 0.1, duration: motion ? 700 : 0 });
	});
</script>
