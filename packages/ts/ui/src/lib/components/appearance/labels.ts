// What each channel's values are called in front of a person. The stored
// vocabulary is an open set (`appearance.ts` and `edge.ts` in @sloppy/types),
// so this covers what this build draws and a look from a newer Sloppy simply
// has no row here.

import type { EdgeStroke, MarkRadius, RingStyle, RingWeight } from '@sloppy/types';

export const RING_WEIGHT_LABELS: Record<RingWeight, string> = {
	none: 'None',
	hairline: 'Thin',
	regular: 'Medium',
	heavy: 'Heavy'
};

export const RING_STYLE_LABELS: Record<RingStyle, string> = {
	solid: 'Solid',
	open: 'Open',
	notched: 'Notched',
	dashed: 'Dashed'
};

export const MARK_RADIUS_LABELS: Record<MarkRadius, string> = {
	small: 'Small',
	regular: 'Medium',
	large: 'Large',
	huge: 'Huge',
	giant: 'Giant'
};

export const EDGE_STROKE_LABELS: Record<EdgeStroke, string> = {
	solid: 'Solid',
	dashed: 'Dashed',
	dotted: 'Dotted'
};
