// The front page's words: Sloppy as it ships against the docs alone, for the middle model, on the
// large projects the aggregate averages.
import { aggregate, largeProjects } from './aggregate';
import { andList, inWords, verdicts, type Metric, type Verdict } from './readings';
import { movedSaid as moved, percent, ratioSign, scoreSaid, scoreSign } from './said';
import type { PageSummary } from './summary';

/** What "better outputs" means, from the aggregate over the large projects. */
export function heroLine(summary: PageSummary): string | null {
	const a = aggregate(summary, 'plain');
	if (!a) return null;
	const { cost, time, turns, input } = a.ratio;
	const parts = [
		`scored ${scoreSaid(a.score)} than with the docs alone`,
		cost !== null && moved(cost, 'cost', 'less', 'more', 'the same'),
		time !== null && moved(time, 'was', 'faster', 'slower', 'as fast'),
		turns !== null &&
			moved(turns, 'took', 'fewer', 'more', 'as many') + ' round trips to the model',
		input !== null && moved(input, 'read', 'fewer', 'more', 'as many') + ' tokens'
	].filter((x): x is string => !!x);
	return `On average across ${inWords(a.subjects.length)} large codebases, Claude Code with Sloppy ${andList(parts)}.`;
}

export interface HeroStat {
	value: string;
	label: string;
}

const signed = (sign: number, size: string) => `${sign > 0 ? '+' : sign < 0 ? '−' : ''}${size}`;

/** Cost, new text read and answer quality against the docs alone, as the hero's three figures. */
export function heroStats(summary: PageSummary): HeroStat[] {
	const a = aggregate(summary, 'plain');
	if (!a) return [];
	const { cost, input } = a.ratio;
	return [
		cost !== null && { value: signed(ratioSign(cost), percent(cost)), label: 'cost per task' },
		input !== null && { value: signed(ratioSign(input), percent(input)), label: 'new text read' },
		{
			value: signed(scoreSign(a.score), Math.abs(a.score).toFixed(3)),
			label: 'answer quality, 0 to 1'
		}
	].filter((x): x is HeroStat => !!x);
}

/** What the hero's figures are measured over, from the same aggregate. */
export function contextLine(summary: PageSummary): string | null {
	const a = aggregate(summary, 'plain');
	if (!a) return null;
	return `On ${inWords(a.subjects.length)} large open-source codebases, against Claude Code with the docs alone — same model, same questions.`;
}

/** What a verdict is called leading a sentence, and after another clause. */
type Said = Record<Verdict, [string, string]>;

/** "Faster on all four projects.", "Fewer on two of the four projects (…) and more on two (…)." */
function tally(summary: PageSummary, metric: Metric, said: Said): string | null {
	const large = largeProjects(summary);
	const rows = verdicts(summary, metric).filter((v) => large.includes(v.subject));
	if (!rows.length) return null;
	const total = large.length;
	const groups = (['better', 'worse', 'level'] as Verdict[])
		.map((verdict) => ({
			verdict,
			names: rows.filter((r) => r.verdict === verdict).map((r) => r.name)
		}))
		.filter((g) => g.names.length);
	// Only the smallest group is named: with every project listed the line runs past what a reader skims.
	const fewest = Math.min(...groups.map((g) => g.names.length));
	const clauses: string[] = [];
	for (const { verdict, names } of groups) {
		const [lead, after] = said[verdict];
		const words = clauses.length ? after : lead;
		if (names.length === total) clauses.push(`${words} on all ${inWords(total)} projects`);
		else
			clauses.push(
				`${words} on ${inWords(names.length)}${clauses.length ? '' : ` of the ${inWords(total)}`}${
					names.length === fewest ? ` (${andList(names)})` : ''
				}`
			);
	}
	return `${clauses.join(', ')}.`;
}

export const frontPoints = (summary: PageSummary): string[] =>
	[
		tally(summary, 'score', {
			better: ['Answers scored higher', 'higher'],
			worse: ['Answers scored lower', 'lower'],
			level: ['Answers scored the same', 'the same']
		}),
		tally(summary, 'time', {
			better: ['Faster', 'faster'],
			worse: ['Slower', 'slower'],
			level: ['As fast', 'as fast']
		}),
		tally(summary, 'input', {
			better: ['Fewer tokens', 'fewer'],
			worse: ['More tokens', 'more'],
			level: ['As many tokens', 'as many']
		})
	].filter((x): x is string => !!x);

/** The loop's result in one line, from the same aggregate as the front page. */
export function outcomeLine(summary: PageSummary): string | null {
	const a = aggregate(summary, 'plain');
	if (!a) return null;
	const { cost, turns } = a.ratio;
	const parts = [
		`scored ${scoreSaid(a.score)}`,
		cost !== null && moved(cost, 'cost', 'less', 'more', 'the same'),
		turns !== null && `${moved(turns, 'took', 'fewer', 'more', 'as many')} round trips`
	].filter((x): x is string => !!x);
	return `On ${inWords(a.subjects.length)} large codebases, against the docs alone, an agent with Sloppy ${andList(parts)}.`;
}
