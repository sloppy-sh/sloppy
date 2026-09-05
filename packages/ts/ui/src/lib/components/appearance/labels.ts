// What each channel's values are called in front of a person. The stored
// vocabulary is an open set (`appearance.ts` in @sloppy/types), so this covers
// what this build draws and a look from a newer Sloppy simply has no row here.

import type { RingStyle, RingWeight } from '@sloppy/types';

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
