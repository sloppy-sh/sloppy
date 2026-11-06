// How a difference between Sloppy and another approach is put in words, on every page and in the
// README: one rounding, so a sentence never calls level what its table or chart shows apart.

export type RatioMetric = 'cost' | 'time' | 'turns' | 'input';

/** Up to this difference a score reads as slightly higher or lower. */
export const SCORE_LEVEL = 0.03;

/** -1, 0 or 1: a score difference's sign as `scoreSaid` rounds it. */
export const scoreSign = (d: number) => (Math.abs(d) < 0.0005 ? 0 : Math.sign(d));

/** -1, 0 or 1: a ratio less one's sign as `percent` rounds it. */
export const ratioSign = (r: number) => (Math.round(r * 100) === 0 ? 0 : Math.sign(r));

export const percent = (r: number) => `${Math.round(Math.abs(r) * 100)}%`;

/** A score difference in words with its size: "slightly higher (+0.013)". */
export const scoreSaid = (d: number) => {
	if (scoreSign(d) === 0) return 'the same';
	const how = d > 0 ? 'higher' : 'lower';
	const size = `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(3)}`;
	return `${Math.abs(d) <= SCORE_LEVEL ? `slightly ${how}` : how} (${size})`;
};

const WORDS: Record<RatioMetric, [string, string]> = {
	cost: ['cheaper', 'more expensive'],
	time: ['faster', 'slower'],
	turns: ['fewer', 'more'],
	input: ['fewer', 'more']
};

/** `-0.16` on cost reads "16% cheaper". */
export const ratioSaid = (m: RatioMetric, r: number | null) =>
	r === null ? '–' : ratioSign(r) === 0 ? 'the same' : `${percent(r)} ${WORDS[m][r < 0 ? 0 : 1]}`;

/** A ratio less one after a verb: `movedSaid(-0.08, 'cost', 'less', 'more', 'the same')` is "cost 8% less". */
export const movedSaid = (r: number, verb: string, less: string, more: string, same: string) =>
	[verb, ratioSign(r) === 0 ? same : `${percent(r)} ${r < 0 ? less : more}`]
		.filter(Boolean)
		.join(' ');
