// The final test's questions, one row per task, as /questions shows them; computed at build by
// $lib/server/questions.

export type Condition = 'bare' | 'agents' | 'mcp';

/** In table order. */
export const CONDITIONS: Condition[] = ['bare', 'agents', 'mcp'];

/** A task family as a reader names it. */
export const FAMILY_LABEL: Record<string, string> = {
	why: 'Why',
	locate: 'Where',
	brief: 'Briefing',
	drift: 'Drift check',
	handoff: 'Handoff'
};

export interface QuestionRow {
	task: string;
	slug: string;
	project: string;
	family: string;
	/** The prompt as the agent was sent it; for a handoff, the second session's. */
	question: string;
	/** A handoff's first session: the change it was asked to make, and the reason it alone was told. */
	stageA: { change: string; reason: string } | null;
	/** Mean over the approach's runs, scored as the charts score them. */
	score: Record<Condition, number>;
	runs: Record<Condition, number>;
	/** With Sloppy less docs alone. */
	gain: number;
	why: string | null;
}

export interface JudgeItem {
	criterion: string;
	score: number;
	reason: string;
}

export interface Fact {
	kind: 'missing' | 'false' | 'unnamed';
	said: string;
}

/** One tool call the agent made, and what it was about. */
export interface Step {
	tool: string;
	about: string;
}

export interface Answer {
	condition: Condition;
	runId: string;
	score: number;
	/** The mean this run is the closest to. */
	mean: number;
	text: string;
	/** Prompt tokens over every stage, fresh and cached. */
	tokensIn: number | null;
	tokensOut: number | null;
	costUsd: number | null;
	wallS: number;
	items: JudgeItem[];
	/** What the facts check found: a fact left out or a thing said that is not so, each as its source says it, or a file or name the answer did not give. */
	facts: Fact[];
	/** The agent's own tool calls in order; null where the run was made before transcripts were kept. */
	trace: Step[] | null;
	/** How many of `trace`, from the start, a handoff's first session made; 0 for one session. */
	firstSession: number;
	/** Tool calls made inside the helpers it started. */
	subagentCalls: number;
}

export interface QuestionDetail {
	task: string;
	answers: Answer[];
}

/** One approach's run on a question the front page shows. */
export interface FeaturedRun {
	runId: string;
	/** The approach's mean over its runs on the question. */
	score: number;
	steps: number;
	firstSession: number;
	subagentCalls: number;
}

/** A question the front page shows: each approach's mean, and its run closest to that mean. */
export interface Featured {
	task: string;
	slug: string;
	label: string;
	family: string;
	/** The prompt's first clause. */
	question: string;
	gain: number;
	plain: FeaturedRun;
	sloppy: FeaturedRun;
}
