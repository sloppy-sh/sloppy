// What a build's sessions are told before anything is said to them: the notes
// whole, the task, the rules, and nothing else of the graph.

import type { BuildTask } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	implementerBrief,
	mergerBrief,
	plannerBrief,
	reviewerBrief,
	type BriefNote,
	type BriefOf
} from './build-brief.js';
import { ref } from './stores/fake-api.test-support.js';

function noteOf(seed: number, over: Partial<BriefNote> = {}): BriefNote {
	return {
		note: ref(seed),
		title: `Note ${seed}`,
		address: `${seed}`,
		sections: [`## What it is for\n\nThe ${seed}th thing.`],
		anchors: [`src/thing-${seed}.ts`],
		...over
	};
}

const TASK: BuildTask = {
	id: 'reader',
	title: 'The reading half',
	effect: 'The project reads a plan off the notes instead of a prompt.',
	paths: ['src/read.ts'],
	notes: [ref(1), ref(2)]
};

function of(notes: readonly BriefNote[], checks: readonly string[] = ['pnpm check']): BriefOf {
	return { notes, checks };
}

describe('the notes a session is handed', () => {
	it('inlines exactly the ones it was given, whole, and names no others', () => {
		const brief = implementerBrief(TASK, of([noteOf(1), noteOf(2)]));

		expect(brief).toContain(ref(1));
		expect(brief).toContain(ref(2));
		expect(brief).not.toContain(ref(3));
		expect(brief.match(/did:syr:/g)?.length).toBe(2);
		expect(brief).toContain('The 1th thing.');
		expect(brief).toContain('The 2th thing.');
	});

	it('names what a note points at in the code, and says when nothing is written in one', () => {
		const brief = implementerBrief(TASK, of([noteOf(1, { sections: [] })]));

		expect(brief).toContain('src/thing-1.ts');
		expect(brief).toContain('Nothing is written in it yet');
	});

	it('heads a numbered note with its address and an unnumbered one with its title', () => {
		const numbered = implementerBrief(TASK, of([noteOf(1, { address: '1a' })]));
		const not = implementerBrief(TASK, of([noteOf(1, { address: undefined })]));

		expect(numbered).toContain('### 1a — Note 1');
		expect(not).toContain('### Note 1');
	});
});

describe('what each role is told it is for', () => {
	it('tells the reading session to answer with the plan and nothing in prose', () => {
		const brief = plannerBrief(of([noteOf(1)]));

		expect(brief).toContain('`plan_build`');
		expect(brief).toContain('Nothing you write in prose is read.');
		expect(brief).toContain('Write nothing. You are reading.');
		// It is the one session that runs in the person's own folder.
		expect(brief).toContain("That folder is the person's own");
	});

	it('tells every other role that its folder is a copy of its own', () => {
		for (const brief of [
			implementerBrief(TASK, of([noteOf(1)])),
			reviewerBrief(TASK, of([noteOf(1)])),
			mergerBrief([TASK], of([noteOf(1)]))
		]) {
			expect(brief).toContain('a copy of the project made for this work alone');
			expect(brief).toContain("Nothing of the person's own is yours to touch");
		}
	});

	it('tells an implementer its task, its places and how to end', () => {
		const brief = implementerBrief(TASK, of([noteOf(1)]));

		expect(brief).toContain('The reading half');
		expect(brief).toContain(TASK.effect);
		expect(brief).toContain('src/read.ts');
		expect(brief).toContain('`hand_off`');
		expect(brief).toContain('`raise_need`');
	});

	it('tells a reviewer that finding nothing is the right answer', () => {
		const brief = reviewerBrief(TASK, of([noteOf(1)]));

		expect(brief).toContain('`review_build`');
		expect(brief).toContain('Clean with nothing found is the right answer');
		expect(brief).toContain('Change nothing yourself.');
	});

	it('gives a merger both tasks’ paragraphs, because a file keeping one side has lost half', () => {
		const second: BuildTask = {
			...TASK,
			id: 'writer',
			title: 'The writing half',
			effect: 'It writes.'
		};
		const brief = mergerBrief([TASK, second], of([noteOf(1)]));

		expect(brief).toContain(TASK.effect);
		expect(brief).toContain('It writes.');
		expect(brief).toContain('lost half the work');
	});
});

describe('the rules every session works under', () => {
	it('says to stay in the copy, push nothing, spawn nothing and ask rather than guess', () => {
		for (const brief of [
			plannerBrief(of([noteOf(1)])),
			implementerBrief(TASK, of([noteOf(1)])),
			reviewerBrief(TASK, of([noteOf(1)])),
			mergerBrief([TASK], of([noteOf(1)]))
		]) {
			expect(brief).toContain('Stay in the folder you were started in');
			expect(brief).toContain('never push anything anywhere');
			expect(brief).toContain('Start no sub-agents of your own');
			expect(brief).toContain('Ask rather than guess');
			expect(brief).toContain('names where it came from');
		}
	});

	it('names the checks, and says to run nothing where the project names none', () => {
		expect(implementerBrief(TASK, of([noteOf(1)], ['pnpm check', 'cargo test']))).toContain(
			'- cargo test'
		);
		expect(implementerBrief(TASK, of([noteOf(1)], []))).toContain('names none, so run nothing');
	});

	it('says no word a person is never shown', () => {
		const brief = implementerBrief(TASK, of([noteOf(1)]));

		for (const never of ['worktree', 'checkout', 'branch']) expect(brief).not.toContain(never);
	});
});
