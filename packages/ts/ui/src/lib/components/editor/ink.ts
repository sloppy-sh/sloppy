// Ink: what a pen leaves behind, and how it is drawn back. Strokes are the
// record (`InkElementData` in @sloppy/types); a canvas is only ever a view of them.

import type { InkPoint, InkStroke } from '@sloppy/types';

/** The nib a stroke is laid down with, before pressure and tilt scale it. */
export const NIB_WIDTH = 2.2;

/** Capture-surface units per CSS pixel of the surface the pen is on. */
export interface InkSurface {
	left: number;
	top: number;
	scale: number;
}

/**
 * The samples an event stands for. Safari 18.2 reports the ones the compositor
 * merged; below that a move is one sample and the stroke is rougher, never
 * unavailable (DESIGN.md § The canvas).
 */
export function samplesOf(event: PointerEvent): PointerEvent[] {
	const coalesced = event.getCoalescedEvents?.();
	return coalesced && coalesced.length > 0 ? coalesced : [event];
}

/** 0.5 is what a contact with no pressure sensor reports, so it is also the floor. */
function pressureOf(event: PointerEvent): number {
	const raw = event.pressure;
	return raw > 0 && raw <= 1 ? raw : 0.5;
}

function tiltOf(event: PointerEvent, axis: 'tiltX' | 'tiltY'): number | undefined {
	const raw = event[axis];
	return typeof raw === 'number' && raw !== 0 ? Math.max(-90, Math.min(90, raw)) : undefined;
}

/** How wide the nib is at this sample: pressure drives it, tilt broadens it. */
export function nibWidth(
	base: number,
	point: Pick<InkPoint, 'pressure' | 'tilt_x' | 'tilt_y'>
): number {
	const lean = Math.min(90, Math.hypot(point.tilt_x ?? 0, point.tilt_y ?? 0)) / 90;
	return base * (0.35 + 1.3 * point.pressure) * (1 + 0.4 * lean);
}

/** Keeps a stroke alive when the pen wanders off the surface it started on. */
export function capturePointer(target: Element, pointerId: number): void {
	try {
		target.setPointerCapture(pointerId);
	} catch {
		// A pointer the platform is not tracking throws rather than refusing, and a
		// stroke drawn without capture is still a stroke.
	}
}

/** One stroke as it is being laid down, in the capture surface's own units. */
export class StrokeInProgress {
	readonly points: InkPoint[] = [];
	readonly width: number;
	#origin: number;

	constructor(event: PointerEvent, surface: InkSurface, width: number) {
		this.width = width;
		this.#origin = event.timeStamp;
		this.extend(event, surface);
	}

	/** The points this event added, so a caller can draw only the new segment. */
	extend(event: PointerEvent, surface: InkSurface): InkPoint[] {
		const added = samplesOf(event).map((sample) => {
			const point: InkPoint = {
				x: (sample.clientX - surface.left) * surface.scale,
				y: (sample.clientY - surface.top) * surface.scale,
				pressure: pressureOf(sample),
				t: Math.max(0, sample.timeStamp - this.#origin)
			};
			const tiltX = tiltOf(sample, 'tiltX');
			const tiltY = tiltOf(sample, 'tiltY');
			if (tiltX !== undefined) point.tilt_x = tiltX;
			if (tiltY !== undefined) point.tilt_y = tiltY;
			return point;
		});
		this.points.push(...added);
		return added;
	}

	/** A pen put down and lifted without moving is a dot, and a dot is a mark. */
	finish(): InkStroke {
		return { points: [...this.points], width: this.width };
	}
}

export interface InkBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export function strokeBounds(strokes: readonly InkStroke[]): InkBounds | null {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const stroke of strokes) {
		for (const point of stroke.points) {
			const reach = nibWidth(stroke.width, point) / 2;
			left = Math.min(left, point.x - reach);
			top = Math.min(top, point.y - reach);
			right = Math.max(right, point.x + reach);
			bottom = Math.max(bottom, point.y + reach);
		}
	}
	return left === Infinity ? null : { left, top, right, bottom };
}

export function translateStrokes(
	strokes: readonly InkStroke[],
	dx: number,
	dy: number
): InkStroke[] {
	return strokes.map((stroke) => ({
		...stroke,
		points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }))
	}));
}

/** `scale` maps capture-surface units onto the context's own, before its DPR transform. */
export function drawStrokes(
	ctx: CanvasRenderingContext2D,
	strokes: readonly InkStroke[],
	scale: number
): void {
	for (const stroke of strokes) drawStroke(ctx, stroke, scale);
}

export function drawStroke(
	ctx: CanvasRenderingContext2D,
	stroke: InkStroke,
	scale: number,
	from = 0
): void {
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	const points = stroke.points;
	if (points.length === 1 && from === 0) {
		const only = points[0];
		ctx.beginPath();
		ctx.arc(
			only.x * scale,
			only.y * scale,
			(nibWidth(stroke.width, only) * scale) / 2,
			0,
			Math.PI * 2
		);
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fill();
		return;
	}
	for (let i = Math.max(1, from); i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		ctx.beginPath();
		ctx.lineWidth = ((nibWidth(stroke.width, a) + nibWidth(stroke.width, b)) / 2) * scale;
		ctx.moveTo(a.x * scale, a.y * scale);
		ctx.lineTo(b.x * scale, b.y * scale);
		ctx.stroke();
	}
}

/**
 * A context whose units are CSS pixels on a backing store sized for the device's.
 * Resizing the backing store is itself a clear, so a caller redrawing everything
 * clears; one appending to a live stroke must not.
 */
export function prepareCanvas(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number
): CanvasRenderingContext2D | null {
	const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
	const width = Math.max(1, Math.round(cssWidth * ratio));
	const height = Math.max(1, Math.round(cssHeight * ratio));
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	return ctx;
}
