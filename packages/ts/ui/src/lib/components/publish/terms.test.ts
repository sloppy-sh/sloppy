import { describe, expect, it } from 'vitest';
import { type PublishSubject, publishingAgain, publishingSays } from './terms.js';

const said = (of: PublishSubject) => publishingSays(of, true).join(' ');

describe('what a publish sends out', () => {
	it('names the graph one branch is read in', () => {
		expect(said({ branch: '1a' })).toContain(
			'The name you gave the graph it sits in goes out too.'
		);
	});

	it('names the graph each of several notes is read in, however many graphs that is', () => {
		expect(said({ notes: 4 })).toContain(
			'The name you gave the graph each of them sits in goes out too.'
		);
	});

	it('calls a branch whatever its author cites it by', () => {
		expect(said({ branch: '1a' })).toContain('Everything under 1a goes out');
		expect(said({ branch: 'this branch' })).toContain('Everything under this branch goes out');
	});

	it('says a second publish sends the same branch by the same name', () => {
		expect(publishingAgain({ branch: 'this branch' })).toBe(
			'Publishing again sends this branch as it stands now. Every version before it stays readable.'
		);
	});
});
