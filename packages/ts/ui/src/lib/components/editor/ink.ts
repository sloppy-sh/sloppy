// Ink: what a pen leaves behind, and how it is drawn back. Strokes are the
// record (`InkElementData` in @sloppy/types); a canvas is only ever a view of them.

import type { InkPoint, InkStroke } from '@sloppy/types';

/** The nib a stroke is laid down with, before pressure and tilt scale it. */
export const NIB_WIDTH = 2.2;

/** How far off the line between its neighbours a sample has to sit to be worth
 *  keeping, in capture-surface units. */
const OFF_THE_LINE = 0.35;
/** A pressure step the nib would show, so the sample that carries it is kept. */
const PRESSURE_STEP = 0.08;
/** Decimal places a coordinate is kept to: finer than a pixel on the densest
 *  screen the canvas is drawn at. */
const PLACES = 2;

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

/** How far `point` sits off the line through `from` and `to`. */
function offTheLine(point: InkPoint, from: InkPoint, to: InkPoint): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const span = Math.hypot(dx, dy);
	if (span === 0) return Math.hypot(point.x - from.x, point.y - from.y);
	return Math.abs(dx * (from.y - point.y) - dy * (from.x - point.x)) / span;
}

function toPlaces(places: number, value: number): number {
	const step = 10 ** places;
	return Math.round(value * step) / step;
}

function rounded(point: InkPoint): InkPoint {
	const kept: InkPoint = {
		x: toPlaces(PLACES, point.x),
		y: toPlaces(PLACES, point.y),
		pressure: toPlaces(PLACES, point.pressure),
		t: Math.round(point.t)
	};
	if (point.tilt_x !== undefined) kept.tilt_x = Math.round(point.tilt_x);
	if (point.tilt_y !== undefined) kept.tilt_y = Math.round(point.tilt_y);
	return kept;
}

/**
 * Whether the segment from `from` to `to` already says what `run` says: every
 * sample of it lies along that segment, close enough to it, at a pressure the
 * nib would show no step in.
 */
function describedBy(from: InkPoint, to: InkPoint, run: readonly InkPoint[]): boolean {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const span = dx * dx + dy * dy;
	return run.every((point) => {
		const along = (point.x - from.x) * dx + (point.y - from.y) * dy;
		return (
			along >= 0 &&
			along <= span &&
			offTheLine(point, from, to) <= OFF_THE_LINE &&
			Math.abs(point.pressure - from.pressure) <= PRESSURE_STEP
		);
	});
}

/**
 * The stroke as it will be drawn back: a whole run of samples is dropped only
 * while the segment across it describes every one of them, and what is left is
 * kept to the precision the canvas draws at, so a note carries the drawing
 * rather than how fast the device that made it sampled.
 */
function thinned(points: readonly InkPoint[]): InkPoint[] {
	const kept: InkPoint[] = [];
	let skipped: InkPoint[] = [];
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const last = kept.at(-1);
		const next = points[i + 1];
		if (last && next && describedBy(last, next, [...skipped, point])) {
			skipped.push(point);
			continue;
		}
		kept.push(rounded(point));
		skipped = [];
	}
	return kept;
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

	#at(sample: PointerEvent, surface: InkSurface): InkPoint {
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
	}

	/** The points this event added, so a caller can draw only the new segment. */
	extend(event: PointerEvent, surface: InkSurface): InkPoint[] {
		const added = samplesOf(event).map((sample) => this.#at(sample, surface));
		this.points.push(...added);
		return added;
	}

	/**
	 * Where the platform expects the pen to go next, empty where it does not say
	 * (DESIGN.md § The canvas). These are drawn ahead of the nib and lifted again;
	 * the stroke records only where the pen has been.
	 */
	predict(event: PointerEvent, surface: InkSurface): InkPoint[] {
		const ahead = event.getPredictedEvents?.();
		return ahead ? ahead.map((sample) => this.#at(sample, surface)) : [];
	}

	/** A pen put down and lifted without moving is a dot, and a dot is a mark. */
	finish(): InkStroke {
		return { points: thinned(this.points), width: this.width };
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

function dot(ctx: CanvasRenderingContext2D, width: number, only: InkPoint, scale: number): void {
	ctx.beginPath();
	ctx.arc(only.x * scale, only.y * scale, (nibWidth(width, only) * scale) / 2, 0, Math.PI * 2);
	ctx.fillStyle = ctx.strokeStyle;
	ctx.fill();
}

function segment(
	ctx: CanvasRenderingContext2D,
	width: number,
	a: InkPoint,
	b: InkPoint,
	scale: number
): void {
	ctx.beginPath();
	ctx.lineWidth = ((nibWidth(width, a) + nibWidth(width, b)) / 2) * scale;
	ctx.moveTo(a.x * scale, a.y * scale);
	ctx.lineTo(b.x * scale, b.y * scale);
	ctx.stroke();
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
		dot(ctx, stroke.width, points[0], scale);
		return;
	}
	for (let i = Math.max(1, from); i < points.length; i++) {
		segment(ctx, stroke.width, points[i - 1], points[i], scale);
	}
}

function reaches(stroke: InkStroke, a: InkPoint, b: InkPoint, region: InkBounds): boolean {
	const reach = Math.max(nibWidth(stroke.width, a), nibWidth(stroke.width, b)) / 2;
	return (
		Math.min(a.x, b.x) - reach <= region.right &&
		Math.max(a.x, b.x) + reach >= region.left &&
		Math.min(a.y, b.y) - reach <= region.bottom &&
		Math.max(a.y, b.y) + reach >= region.top
	);
}

/**
 * Lifts everything inside `region` and lays the strokes back down there, so a
 * mark drawn over them can be taken away without repainting the whole surface.
 * `region` is in the strokes' own units.
 */
export function redrawWithin(
	ctx: CanvasRenderingContext2D,
	strokes: readonly InkStroke[],
	scale: number,
	region: InkBounds
): void {
	const left = region.left * scale;
	const top = region.top * scale;
	const width = (region.right - region.left) * scale;
	const height = (region.bottom - region.top) * scale;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, width, height);
	ctx.clip();
	ctx.clearRect(left, top, width, height);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const stroke of strokes) {
		const points = stroke.points;
		if (points.length === 1) {
			if (reaches(stroke, points[0], points[0], region)) dot(ctx, stroke.width, points[0], scale);
			continue;
		}
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			if (reaches(stroke, a, b, region)) segment(ctx, stroke.width, a, b, scale);
		}
	}
	ctx.restore();
}

/**
 * Draws where the platform expects the stroke to go next, and answers with the
 * region that mark covers so the next real sample can lift it. Null where there
 * is nothing to draw ahead.
 */
export function drawAhead(
	ctx: CanvasRenderingContext2D,
	live: { points: readonly InkPoint[]; width: number },
	ahead: readonly InkPoint[],
	scale: number
): InkBounds | null {
	const last = live.points.at(-1);
	if (!last || ahead.length === 0) return null;
	const provisional: InkStroke = { points: [last, ...ahead], width: live.width };
	drawStroke(ctx, provisional, scale);
	return strokeBounds([provisional]);
}

/**
 * A context whose units are CSS pixels on a backing store sized for the device's,
 * with the canvas's top-left corner at `origin`. Resizing the backing store is
 * itself a clear, so a caller redrawing everything clears; one appending to a
 * live stroke must not.
 */
export function prepareCanvas(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number,
	origin: { left: number; top: number } = { left: 0, top: 0 }
): CanvasRenderingContext2D | null {
	const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
	const width = Math.max(1, Math.round(cssWidth * ratio));
	const height = Math.max(1, Math.round(cssHeight * ratio));
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.setTransform(ratio, 0, 0, ratio, -origin.left * ratio, -origin.top * ratio);
	return ctx;
}
