<script lang="ts">
	import type { GraphLens } from '@sloppy/graph';
	import type { NodeView, OwnedRef } from '@sloppy/types';
	import { untrack } from 'svelte';
	import GraphSurface from './graph-surface.svelte';

	type Drive = (next: { nodes?: NodeView[]; lens?: GraphLens | null }) => void;

	let props: { nodes: NodeView[]; drive: (set: Drive) => void } = $props();

	let nodes = $state<NodeView[]>(untrack(() => props.nodes));
	let lens = $state<GraphLens | null>(null);

	untrack(() => props.drive)((next) => {
		if (next.nodes !== undefined) nodes = next.nodes;
		if (next.lens !== undefined) lens = next.lens;
	});

	const noop = () => {};
</script>

<GraphSurface
	{nodes}
	collapsed={new Set<OwnedRef>()}
	{lens}
	onOpenNode={noop}
	onExpand={noop}
	onCollapse={noop}
/>
