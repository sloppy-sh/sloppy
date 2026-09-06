import type { Address } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { type PublishSubject, publishingSays } from './terms.js';

const said = (of: PublishSubject) => publishingSays(of, true).join(' ');

describe('what a publish sends out', () => {
	it('names the graph one branch is read in', () => {
		expect(said({ address: '1a' as Address })).toContain(
			'The name you gave the graph it sits in goes out too.'
		);
	});

	it('names the graph each of several notes is read in, however many graphs that is', () => {
		expect(said({ notes: 4 })).toContain(
			'The name you gave the graph each of them sits in goes out too.'
		);
	});
});
