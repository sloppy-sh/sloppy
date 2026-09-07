<script lang="ts" module>
	import type { GraphSurfaceProps } from '@sloppy/graph';

	/** How the canvas hands a pen event over: the event, and the point it lands
	 *  on in the field's own coordinates. */
	export type CanvasPen = NonNullable<GraphSurfaceProps['onInkPointer']>;
</script>

<script lang="ts">
	/* eslint-disable no-useless-assignment -- the canvas is handed the pen and
	   calls it; nothing in here reads it back. */

	// What a pen leaves over the graph, drawn into the layer the renderer hands
	// back — DESIGN.md § "The canvas". Points are in the field's own coordinates,
	// so a stroke stays on the marks it was drawn over through a pan and a zoom.
	import type { GraphTransform } from '@sloppy/graph';
	import type { InkStroke } from '@sloppy/types';
	import {
		drawStroke,
		drawStrokes,
		NIB_WIDTH,
		prepareCanvas,
		StrokeInProgress
	} from '../editor/ink.js';

	let {
		layer,
		transform,
		strokes,
		ondrawn,
		pen = $bindable()
	}: {
		/** The layer over the canvas, off the renderer's handle. Absent until the
		 *  canvas is up. */
		layer?: HTMLElement;
		/** Where the field is looking. Absent until the canvas has said. */
		transform?: GraphTransform;
		/** In the field's coordinates, oldest first. */
		strokes: readonly InkStroke[];
		/** A stroke the pen finished, in those same coordinates. */
		ondrawn: (stroke: InkStroke) => void;
		/** Bound out for the canvas to hand its pen events to. */
		pen?: CanvasPen;
	} = $props();

	let sheet = $state<HTMLCanvasElement>();
	let box = $state({ width: 0, height: 0 });
	let wet: StrokeInProgress | null = null;
	let onSheet = false;

	/**
	 * The surface `StrokeInProgress` measures against, worked out from the point
	 * the canvas already resolved — so the samples an event coalesced land in the
	 * field's coordinates without this reading a box the canvas may disagree with.
	 */
	function fieldUnder(event: PointerEvent, world: { x: number; y: number }, at: GraphTransform) {
		return {
			left: event.clientX - world.x * at.scale,
			top: event.clientY - world.y * at.scale,
			scale: 1 / at.scale
		};
	}

	const inkPointer: CanvasPen = (event, world) => {
		const at = transform;
		if (!at) return;
		const surface = fieldUnder(event, world, at);
		if (event.type === 'pointerdown') {
			// Laid down at the width it looks on screen, in field units, so zooming
			// out thins it along with everything else on the paper.
			wet = new StrokeInProgress(event, surface, NIB_WIDTH / at.scale);
		} else if (wet) {
			wet.extend(event, surface);
		} else {
			return;
		}
		if (event.type === 'pointerup' || event.type === 'pointercancel') {
			const stroke = wet.finish();
			wet = null;
			ondrawn(stroke);
		}
		redraw();
	};

	function redraw(): void {
		const canvas = sheet;
		const at = transform;
		if (!canvas || !at || box.width === 0 || box.height === 0) return;
		const marks = strokes.length > 0 || wet !== null;
		if (!marks && !onSheet) return;
		const ctx = prepareCanvas(canvas, box.width, box.height);
		if (!ctx) return;
		ctx.clearRect(0, 0, box.width, box.height);
		onSheet = marks;
		if (!marks) return;
		ctx.strokeStyle = getComputedStyle(canvas).color;
		ctx.fillStyle = ctx.strokeStyle;
		ctx.translate(at.x, at.y);
		ctx.scale(at.scale, at.scale);
		drawStrokes(ctx, strokes, 1);
		if (wet) drawStroke(ctx, { points: wet.points, width: wet.width }, 1);
	}

	$effect(() => {
		const on = layer;
		const canvas = sheet;
		if (!on || !canvas) return;
		on.append(canvas);
		const measure = () => {
			const rect = on.getBoundingClientRect();
			box = { width: rect.width, height: rect.height };
		};
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(on);
		return () => watching.disconnect();
	});

	// Taken back with this surface, so a stylus over a canvas with nothing to ink
	// into pans rather than doing nothing at all.
	$effect(() => {
		pen = inkPointer;
		return () => (pen = undefined);
	});

	$effect(() => {
		redraw();
	});
</script>

{#if layer}
	<canvas bind:this={sheet} class="pointer-events-none absolute inset-0 size-full text-foreground"
	></canvas>
{/if}
