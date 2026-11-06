<script lang="ts">
	import { BaseEdge, EdgeLabel, getBezierPath, type EdgeProps } from '@xyflow/svelte';

	let {
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		label,
		data
	}: EdgeProps = $props();

	const geometry = $derived(
		getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
	);
	const live = $derived(Boolean(data?.live));
	const moving = $derived(live && Boolean(data?.motion));
</script>

<BaseEdge path={geometry[0]} class={['flow-edge', live && 'is-live']} />
{#if moving}
	<circle r="4" class="flow-pulse">
		<animateMotion dur="1.8s" repeatCount="indefinite" path={geometry[0]} />
	</circle>
{/if}
{#if label && live}
	<EdgeLabel x={geometry[1]} y={geometry[2]} class="flow-edge-label">{label}</EdgeLabel>
{/if}
