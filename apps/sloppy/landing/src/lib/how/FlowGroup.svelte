<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { Region } from './pipeline';

	let { data }: { data: { region: Region } } = $props();

	const region = $derived(data.region);
</script>

<div class="flow-region" data-aside={region.aside ? 'true' : undefined}>
	<Handle id="top" type="target" position={Position.Top} isConnectable={false} />
	<Handle id="left" type="target" position={Position.Left} isConnectable={false} />
	<p class="flow-region-label">{region.label}</p>
</div>
