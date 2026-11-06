// A project's outcome in one line, for the results page: each metric against the docs alone, in the
// words and rounding of said.ts.
import { compare, pairOf, type Metric } from './readings';
import { movedSaid as moved, scoreSaid } from './said';
import type { PageSummary, Tier } from './summary';

const SAID: Record<Metric, (sloppy: number, plain: number) => string> = {
	score: (s, p) => `Scored ${scoreSaid(s - p)}`,
	input: (s, p) => moved(s / p - 1, '', 'fewer tokens', 'more tokens', 'as many tokens'),
	cost: (s, p) => moved(s / p - 1, '', 'cheaper', 'more expensive', 'the same cost'),
	time: (s, p) => moved(s / p - 1, '', 'faster', 'slower', 'as fast')
};

export function oneLine(summary: PageSummary, subject: string, tier: Tier): string | null {
	const pair = pairOf(summary, subject, tier);
	if (!pair) return null;
	const [score, ...rest] = (['score', 'input', 'cost', 'time'] as Metric[]).map((m) => {
		const c = compare(pair, m);
		return c && SAID[m](c.sloppy, c.plain);
	});
	const took = rest.filter((x): x is string => !!x).join(', ');
	return score ? `${score}${took ? `; ${took}` : ''}.` : took ? `${took}.` : null;
}
