// The final test's questions, one row per task, as /questions shows them; computed at build by
// $lib/server/questions.

export type Condition = 'bare' | 'agents' | 'mcp';

/** In table order. */
export const CONDITIONS: Condition[] = ['bare', 'agents', 'mcp'];

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
}

export interface QuestionDetail {
	task: string;
	answers: Answer[];
}
