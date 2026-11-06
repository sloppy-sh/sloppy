// One page per benchmark subject: what the project is, how its documents are named, and why
// Sloppy came out as it did there, read from that project's transcripts. The reasons are keyed by
// the outcome they explain, so a re-export that flips an outcome shows no reason rather than a
// wrong one. Only the reasons are written here; every number is the summary's.
import { compare, type Metric, type Pair, type Verdict } from './readings';
import type { Tier } from './summary';

/** Null where the runs give no reason for this outcome. */
type Reason = (p: Pair) => string | null;
type Reasons = Partial<Record<Tier, Partial<Record<Metric, Partial<Record<Verdict, Reason>>>>>>;

export interface Project {
	slug: string;
	subject: string;
	/** What the project is, and how its documents are named. */
	about: string;
	reasons: Reasons;
}

const turns: Reason = ({ sloppy, plain }) =>
	`${Math.round(sloppy.turns_mean ?? 0)} round trips to the model against ${Math.round(plain.turns_mean ?? 0)}`;
const tokensAre = (p: Pair, verdict: Verdict) => compare(p, 'input')?.verdict === verdict;
/** Cost explained by the tokens read. Earlier turns read again are billed far below new text. */
const cheaperReading: Partial<Record<Verdict, Reason>> = {
	better: (p) =>
		tokensAre(p, 'better')
			? 'Fewer tokens read, so it costs less.'
			: tokensAre(p, 'worse')
				? 'The extra tokens are earlier turns read again, which is cheap; with Sloppy the agent took in less new text and wrote shorter answers, and those are what cost.'
				: null,
	worse: (p) => (tokensAre(p, 'worse') ? 'More tokens read, so it costs more.' : null)
};
/** One reason for a small score difference either way. */
const slight = (said: string, ...verdicts: Verdict[]) =>
	Object.fromEntries(verdicts.map((v) => [v, () => said])) as Partial<Record<Verdict, Reason>>;

export const PROJECTS: Project[] = [
	{
		slug: 'gitlab',
		subject: 'gitlab',
		about:
			'The code-hosting platform. Its development documents sit in folders, each file named for what it covers.',
		reasons: {
			medium: {
				score: slight(
					"Ahead on why-questions, behind on briefings, where it worked from Sloppy's excerpts instead of reading the one document whole.",
					'better',
					'level'
				),
				input: {
					worse: () =>
						"Files named for what they cover are found by a filename search; Sloppy's first answer adds to what the agent reads anyway."
				},
				cost: cheaperReading,
				time: {
					better: () =>
						"Why-questions often end at Sloppy's first answer, where a search goes through the code."
				}
			}
		}
	},
	{
		slug: 'milvus',
		subject: 'milvus',
		about:
			'A vector database. Its design documents are named by the date they were written, so a name rarely says what one answers.',
		reasons: {
			medium: {
				score: {
					better: () =>
						'With Sloppy the reason came from the design document; without it, often rebuilt from the code.'
				},
				input: {
					better: () =>
						'Documents named by date are hard to find, so without Sloppy the agent read guides and code instead, sometimes never opening the one that answers.'
				},
				cost: cheaperReading,
				time: { better: (p) => `${turns(p)}: Sloppy's first answer names the document.` }
			}
		}
	},
	{
		slug: 'pulsar',
		subject: 'pulsar',
		about:
			'A message broker. Its design proposals are named by number, so a name never says what one answers.',
		reasons: {
			medium: {
				score: {
					better: () =>
						'Without Sloppy the agent often answered why-questions from the code alone; with it, from the proposal.'
				},
				input: {
					better: () =>
						"Where Sloppy's first answer named the classes, the agent searched for them instead of reading file after file, which saved more than the first answer added."
				},
				cost: cheaperReading,
				time: { better: (p) => `${turns(p)}: the proposal comes in the first answer.` }
			}
		}
	},
	{
		slug: 'llvm',
		subject: 'llvm',
		about:
			'The compiler toolchain behind Clang, Flang and MLIR. Each part keeps its own documents folder, every file named for its topic.',
		reasons: {
			medium: {
				score: slight(
					"Close: ahead on where-questions, where Sloppy's first answer named files a search missed, and behind on the drift check — every approach found the same defect there, but the runs with Sloppy more often hedged over whether the document or the code was right.",
					'better',
					'level'
				),
				input: {
					worse: () =>
						"Documents named for their topics are found by a search either way; Sloppy's first answer and its notes are read on top."
				},
				cost: cheaperReading
			}
		}
	},
	{
		slug: 'carbon',
		subject: 'carbon',
		about:
			'An experimental successor to C++, with its compiler. Its design documents are named for their topics, and its proposals by number with the topic beside it.',
		reasons: {
			medium: {
				score: slight(
					"Where-questions gained most: Sloppy's first answer lists the files each note points at, so fewer were missed.",
					'better'
				),
				input: {
					worse: () =>
						"A proposal's topic is in its filename, so a search finds it; Sloppy's first answer is read on top."
				},
				cost: cheaperReading,
				time: {
					worse: () =>
						'A long note is read in pieces, a step each, where a search opens the proposal whole in one.'
				}
			}
		}
	},
	{
		slug: 'dotnet',
		subject: 'dotnet',
		about:
			'The .NET runtime and its base libraries. Its design documents sit in folders by component, each file named for its topic.',
		reasons: {
			medium: {
				input: {
					worse: () =>
						"Documents in a folder named for their component are found by listing it; Sloppy's first answer is read on top."
				},
				cost: cheaperReading,
				time: {
					worse: () =>
						'The agent asked Sloppy first, then read the same documents a folder listing finds anyway.'
				}
			}
		}
	}
];

export const projectOf = (subject: string) => PROJECTS.find((p) => p.subject === subject);

/** The reason for an outcome, or what to say where the runs give none. */
export function reasonFor(
	project: Project,
	tier: Tier,
	metric: Metric,
	verdict: Verdict,
	pair: Pair
): string {
	const reason = project.reasons[tier]?.[metric]?.[verdict]?.(pair);
	if (reason) return reason;
	return verdict === 'level' ? 'No clear difference.' : 'No clear reason in the runs yet.';
}
