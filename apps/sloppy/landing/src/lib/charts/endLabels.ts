/**
 * Label positions as near `targets` as they can be while staying `gap` apart and inside
 * [top, bottom], returned in the order given. Labels that would collide are stacked as a
 * group centred on the mean of their targets.
 */
export function placeLabels(targets: number[], gap: number, top: number, bottom: number): number[] {
	const order = targets.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
	let groups = order.map((o) => ({ targets: [o.y], start: o.y }));
	const end = (g: (typeof groups)[number]) => g.start + (g.targets.length - 1) * gap;

	for (let merged = true; merged; ) {
		merged = false;
		for (let k = 0; k + 1 < groups.length; k++) {
			if (groups[k + 1].start - end(groups[k]) >= gap) continue;
			const together = [...groups[k].targets, ...groups[k + 1].targets];
			const mean = together.reduce((a, b) => a + b, 0) / together.length;
			groups = [
				...groups.slice(0, k),
				{ targets: together, start: mean - ((together.length - 1) * gap) / 2 },
				...groups.slice(k + 2)
			];
			merged = true;
			break;
		}
	}

	const placed = groups.flatMap((g) => g.targets.map((_, j) => g.start + j * gap));
	for (let k = 0; k < placed.length; k++)
		placed[k] = Math.max(placed[k], k ? placed[k - 1] + gap : top);
	for (let k = placed.length - 1; k >= 0; k--)
		placed[k] = Math.min(placed[k], k < placed.length - 1 ? placed[k + 1] - gap : bottom);

	const out: number[] = [];
	order.forEach((o, k) => (out[o.i] = placed[k]));
	return out;
}
