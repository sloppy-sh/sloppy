<script lang="ts">
	import type { GraphHandle } from '@sloppy/graph';
	import type { NodeView, OwnedRef, Tag } from '@sloppy/types';
	import { untrack } from 'svelte';
	import GraphSurface from './graph-surface.svelte';

	type Drive = (next: { nodes?: NodeView[]; selection?: Tag[] }) => void;

	let props: {
		nodes: NodeView[];
		drive: (set: Drive) => void;
		held?: (handle: GraphHandle | undefined) => void;
	} = $props();

	let nodes = $state<NodeView[]>(untrack(() => props.nodes));
	let selection = $state<Tag[]>([]);
	let handle = $state<GraphHandle>();

	$effect(() => untrack(() => props.held)?.(handle));

	untrack(() => props.drive)((next) => {
		if (next.nodes !== undefined) nodes = next.nodes;
		if (next.selection !== undefined) selection = next.selection;
	});

	const noop = () => {};
</script>

<GraphSurface
	bind:handle
	{nodes}
	collapsed={new Set<OwnedRef>()}
	{selection}
	onOpenNode={noop}
	onExpand={noop}
	onCollapse={noop}
/>
