<script lang="ts">
	import '@xyflow/svelte/dist/style.css';
	import { SvelteFlow, type Edge, type Node, type Rect } from '@xyflow/svelte';
	import { onMount, untrack } from 'svelte';
	import Camera from './Camera.svelte';
	import FlowCard from './FlowCard.svelte';
	import FlowEdge from './FlowEdge.svelte';
	import FlowGroup from './FlowGroup.svelte';
	import {
		CARDS,
		LINKS,
		PAD,
		REGIONS,
		STAGES,
		corner,
		guess,
		type Card,
		type RegionId,
		type StageId
	} from './pipeline';
	import { SHOTS, framing } from './shots';

	let { outcome }: { outcome: string | null } = $props();

	const nodeTypes = { card: FlowCard, region: FlowGroup };
	/** Nothing on the canvas is picked, moved or deleted, so it is described as nothing of the kind. */
	const QUIET = {
		'node.a11yDescription.default': '',
		'node.a11yDescription.keyboardDisabled': '',
		'edge.a11yDescription.default': ''
	};
	const edgeTypes = { flow: FlowEdge };
	/** How long each stage is shown before the next, while playing. */
	const DWELL = 7000;

	let step = $state(0);
	let playing = $state(false);
	let motion = $state(false);
	let narrow = $state(true);
	const layout = $derived(narrow ? 'narrow' : 'wide');

	const cards = $derived(
		CARDS.flatMap((c): Card[] =>
			c.id === 'outcome' ? (outcome ? [{ ...c, body: outcome }] : []) : [c]
		)
	);
	const current = $derived(STAGES[step]);
	const shown = $derived(current.id);
	const shot = $derived(SHOTS[shown]);
	const lit = (stage: StageId) => shown === 'whole' || stage === shown;

	/** Enough room for the cards until they are measured, so nothing is clamped on the first frame. */
	const roomFor = (region: RegionId) => {
		let width = 0;
		let height = 0;
		for (const card of cards.filter((c) => c.region === region)) {
			const size = guess(card);
			width = Math.max(width, PAD.side + card.at[layout][0] + size.width + PAD.side);
			height = Math.max(height, PAD.top + card.at[layout][1] + size.height + PAD.bottom);
		}
		return { width, height };
	};

	const drawnNodes = (): Node[] => [
		...REGIONS.map((region) => ({
			id: region.id,
			type: 'region',
			position: { x: region.at[layout][0], y: region.at[layout][1] },
			...roomFor(region.id),
			data: { region },
			class: `lit-${region.stage}`,
			draggable: false,
			selectable: false,
			connectable: false
		})),
		...cards.map((card) => ({
			id: card.id,
			type: 'card',
			parentId: card.region,
			extent: 'parent' as const,
			position: { x: PAD.side + card.at[layout][0], y: PAD.top + card.at[layout][1] },
			data: { card },
			class: `lit-${REGIONS.find((r) => r.id === card.region)!.stage}`,
			draggable: false,
			selectable: false,
			connectable: false
		}))
	];

	/** Down where the next card is below or behind, across where it is ahead. */
	function sides(from: string, to: string) {
		const [x0, y0] = corner(from, layout);
		const [x1, y1] = corner(to, layout);
		const down = x1 - x0 < 120 || Math.abs(y1 - y0) > Math.abs(x1 - x0);
		return down
			? { sourceHandle: 'bottom', targetHandle: 'top' }
			: { sourceHandle: 'right', targetHandle: 'left' };
	}

	const onCanvas = $derived(new Set([...REGIONS.map((r) => r.id), ...cards.map((c) => c.id)]));

	const drawnEdges = (): Edge[] =>
		STAGES.flatMap((stage) =>
			LINKS[stage.id]
				.filter((l) => onCanvas.has(l.from) && onCanvas.has(l.to))
				.map((l) => ({
					id: `${l.from}-${l.to}`,
					source: l.from,
					target: l.to,
					...sides(l.from, l.to),
					type: 'flow',
					label: l.label,
					selectable: false,
					data: { live: lit(stage.id), motion }
				}))
		);

	let nodes = $state.raw<Node[]>(untrack(drawnNodes));
	let edges = $state.raw<Edge[]>(untrack(drawnEdges));

	$effect(() => {
		nodes = drawnNodes();
	});

	/** Each region is the box its own cards came out as, which is what keeps them inside it. */
	$effect(() => {
		const want: Record<string, { width: number; height: number }> = {};
		for (const node of nodes) {
			const size = node.measured;
			if (!node.parentId || !size?.width || !size.height) continue;
			const grown = want[node.parentId] ?? { width: 0, height: 0 };
			want[node.parentId] = {
				width: Math.max(grown.width, node.position.x + size.width + PAD.side),
				height: Math.max(grown.height, node.position.y + size.height + PAD.bottom)
			};
		}
		let moved = false;
		const next = nodes.map((node) => {
			const size = want[node.id];
			if (!size || (node.width === size.width && node.height === size.height)) return node;
			moved = true;
			return { ...node, ...size };
		});
		if (moved) nodes = next;
	});

	$effect(() => {
		edges = drawnEdges();
	});

	/** What the camera is pointed at: the regions this step lights, together. */
	const target = $derived.by((): Rect => {
		const boxes = REGIONS.filter((r) => lit(r.stage)).map((region) => {
			const node = nodes.find((n) => n.id === region.id);
			const [x, y] = region.at[layout];
			return { x, y, width: node?.width ?? 0, height: node?.height ?? 0 };
		});
		const x = Math.min(...boxes.map((b) => b.x));
		const y = Math.min(...boxes.map((b) => b.y));
		return {
			x,
			y,
			width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
			height: Math.max(...boxes.map((b) => b.y + b.height)) - y
		};
	});

	onMount(() => {
		const wide = matchMedia('(min-width: 768px)');
		const calm = matchMedia('(prefers-reduced-motion: reduce)');
		const read = () => {
			narrow = !wide.matches;
			motion = !calm.matches;
		};
		read();
		playing = motion;
		wide.addEventListener('change', read);
		calm.addEventListener('change', read);
		return () => {
			wide.removeEventListener('change', read);
			calm.removeEventListener('change', read);
		};
	});

	$effect(() => {
		if (!playing) return;
		// Read here, not in the callback: the effect must run again on each stage to schedule the next.
		const from = step;
		const timer = setTimeout(() => (step = (from + 1) % STAGES.length), DWELL);
		return () => clearTimeout(timer);
	});

	function go(i: number) {
		playing = false;
		step = i;
	}
</script>

<div class="how">
	<ol class="how-steps" aria-label="Stages">
		{#each STAGES as stage, i (stage.id)}
			<li>
				<button
					type="button"
					class="how-step"
					aria-current={i === step ? 'step' : undefined}
					onclick={() => go(i)}>{i + 1}<span class="sr-only">. {stage.title}</span></button
				>
			</li>
		{/each}
		<li>
			<button
				type="button"
				class="how-step how-play"
				aria-pressed={playing}
				onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button
			>
		</li>
	</ol>

	<div class="how-says" aria-live="polite">
		<h2 class="type-h2">{current.title}</h2>
		<p class="type-body text-muted-foreground">{current.says}</p>
	</div>

	{#if shot}
		<figure class="how-shot">
			<div class="how-shot-frame screenshot" style={framing(shot)}>
				<img src={shot.src} alt={shot.alt} width="1600" height="1039" loading="lazy" />
			</div>
			<figcaption>{shot.caption}</figcaption>
		</figure>
	{/if}

	<div class="how-flow" data-stage={shown}>
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			{edgeTypes}
			minZoom={0.1}
			maxZoom={1}
			nodesDraggable={false}
			nodesConnectable={false}
			elementsSelectable={false}
			panOnDrag={false}
			zoomOnScroll={false}
			zoomOnPinch={false}
			zoomOnDoubleClick={false}
			preventScrolling={false}
			disableKeyboardA11y
			ariaLabelConfig={QUIET}
		>
			<Camera at={target} {motion} />
		</SvelteFlow>
	</div>
</div>

<style>
	.how {
		display: grid;
		row-gap: 1.5rem;
		grid-template-areas:
			'steps'
			'says'
			'flow'
			'shot';
	}
	@media (min-width: 1024px) {
		.how {
			grid-template-columns: 7fr 5fr;
			column-gap: 3rem;
			grid-template-areas:
				'steps steps'
				'says shot'
				'flow flow';
		}
	}

	.how-steps {
		grid-area: steps;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.how-step {
		min-width: 2.5rem;
		height: 2.5rem;
		padding-inline: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.how-step:hover {
		color: var(--foreground);
	}
	.how-step[aria-current='step'] {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}
	.how-play {
		margin-inline-start: 0.5rem;
	}

	.how-says {
		grid-area: says;
		display: grid;
		align-content: start;
		row-gap: 1rem;
		min-height: 15rem;
	}
	@media (min-width: 640px) {
		.how-says {
			min-height: 11rem;
		}
	}
	/* Beside the picture, and tall enough for the longest stage, so no step moves the canvas. */
	@media (min-width: 1024px) {
		.how-says {
			min-height: 15.5rem;
		}
	}

	.how-shot {
		grid-area: shot;
		align-self: start;
	}
	.how-shot-frame {
		position: relative;
		overflow: hidden;
		aspect-ratio: var(--shot-a);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
	}
	.how-shot-frame img {
		position: absolute;
		top: 0;
		left: 0;
		max-width: none;
		width: calc(100% / var(--shot-w));
		height: auto;
		transform: translate(calc(var(--shot-x) * -100%), calc(var(--shot-y) * -100%));
	}
	.how-shot figcaption {
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
	}

	.how-flow {
		grid-area: flow;
		height: 34rem;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--card);
		--xy-background-color: transparent;
		--xy-node-border-radius: 0.75rem;
	}
	@media (min-width: 1024px) {
		.how-flow {
			height: 38rem;
		}
	}
	.how-flow :global(.svelte-flow__node) {
		transition: opacity 250ms cubic-bezier(0.25, 1, 0.5, 1);
		cursor: default;
	}
	.how-flow[data-stage='notes'] :global(.svelte-flow__node:not(.lit-notes)),
	.how-flow[data-stage='code'] :global(.svelte-flow__node:not(.lit-code)),
	.how-flow[data-stage='shape'] :global(.svelte-flow__node:not(.lit-shape)),
	.how-flow[data-stage='serve'] :global(.svelte-flow__node:not(.lit-serve)),
	.how-flow[data-stage='loop'] :global(.svelte-flow__node:not(.lit-loop)) {
		opacity: 0.22;
	}
	.how-flow :global(.svelte-flow__handle) {
		opacity: 0;
		pointer-events: none;
	}

	.how-flow :global(.flow-region) {
		width: 100%;
		height: 100%;
		border: 1px solid var(--border);
		border-radius: 0.875rem;
		background: color-mix(in oklab, var(--muted) 45%, transparent);
	}
	.how-flow :global(.flow-region[data-aside]) {
		border-style: dashed;
		border-color: var(--muted-foreground);
		background: transparent;
	}
	.how-flow :global(.flow-region-label) {
		padding: 0.6rem 0.9rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.how-flow :global(.flow-card) {
		width: 15rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--background);
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.how-flow :global(.flow-card[data-kind='actor']) {
		width: 10rem;
	}
	.how-flow :global(.flow-card[data-kind='mini']) {
		width: 9.5rem;
		padding: 0.4rem 0.6rem;
		border-radius: 999px;
		text-align: center;
	}
	.how-flow :global(.flow-card[data-kind='step']) {
		padding: 0.5rem 0.875rem;
	}
	.how-flow :global(.flow-card[data-kind='note']),
	.how-flow :global(.flow-card[data-kind='result']) {
		border-color: var(--primary);
	}
	.how-flow :global(.flow-card[data-kind='tool']) {
		background: var(--muted);
	}
	.how-flow :global(.flow-card-title) {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-weight: 600;
	}
	.how-flow :global(.flow-card-icon) {
		flex: none;
		margin-top: 0.15rem;
		color: var(--muted-foreground);
	}
	.how-flow :global(.flow-card[data-kind='tool'] .flow-card-title) {
		font-family: var(--font-mono, ui-monospace, monospace);
	}
	.how-flow :global(.flow-card-body) {
		margin-top: 0.25rem;
		color: var(--muted-foreground);
	}
	.how-flow :global(.flow-card-code) {
		margin-top: 0.4rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		color: var(--primary);
		overflow-wrap: anywhere;
	}
	.how-flow :global(.flow-edge) {
		stroke: var(--border);
		stroke-width: 1.5;
		transition: stroke 250ms;
	}
	.how-flow :global(.flow-edge.is-live) {
		stroke: var(--primary);
		stroke-width: 2;
	}
	.how-flow :global(.flow-pulse) {
		fill: var(--primary);
	}
	.how-flow :global(.flow-edge-label) {
		padding: 0.1rem 0.4rem;
		border-radius: 0.375rem;
		background: var(--card);
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.how-flow :global(.svelte-flow__node),
		.how-flow :global(.flow-edge) {
			transition: none;
		}
	}
</style>
