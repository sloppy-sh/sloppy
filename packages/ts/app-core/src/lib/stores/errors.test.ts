import { SloppyApiError } from '@sloppy/client';
import { HistoryError, LocalIdentityError, OutsideRootError } from '@sloppy/local';
import { Refusal } from '@sloppy/ui';
import { encodeText, readGraphFile, VAULT_FORMAT } from '@sloppy/vault';
import { describe, expect, it } from 'vitest';
import { refusal, serverMessage, wordsFor } from './errors.js';

describe('the server’s own words for a person', () => {
	it('are shown where the server wrote some', () => {
		const err = new SloppyApiError(400, 'POST /graphs failed with 400', {
			detail: 'That name is already taken.'
		});

		expect(serverMessage(err)).toBe('That name is already taken.');
	});

	it('are nothing where the failure carried none', () => {
		expect(serverMessage(new SloppyApiError(500, 'GET /graphs failed with 500'))).toBeUndefined();
		expect(serverMessage(new Error('a bug in a component'))).toBeUndefined();
	});

	it('are nothing where a framework answered for the server', () => {
		const err = new SloppyApiError(500, 'GET /graphs failed with 500', {
			detail: 'Internal server error'
		});

		expect(serverMessage(err)).toBeUndefined();
	});

	it('still show a refusal that happens to be worded that way', () => {
		const err = new SloppyApiError(400, 'GET /graphs failed with 400', {
			detail: 'Internal server error'
		});

		expect(serverMessage(err)).toBe('Internal server error');
	});
});

describe('the words a surface may put in front of a person', () => {
	it('are the ones a server or a graph on this device wrote for one', () => {
		const err = new SloppyApiError(409, 'PATCH /nodes failed with 409', {
			detail: 'That note was written somewhere else. Open it again.'
		});

		expect(wordsFor(err)).toBe('That note was written somewhere else. Open it again.');
	});

	it('are the line the shell rejects with, which never crossed a type', () => {
		expect(wordsFor('Sloppy needs your go-ahead to read and write in that folder.')).toBe(
			'Sloppy needs your go-ahead to read and write in that folder.'
		);
		expect(wordsFor('   ')).toBeUndefined();
	});

	it('are what a refusal already carries', () => {
		expect(wordsFor(new Refusal('That folder holds no graph.'))).toBe(
			'That folder holds no graph.'
		);
	});

	it('are what this device says when it will not read its own identities', () => {
		expect(wordsFor(new LocalIdentityError())).toContain('could not be read');
	});

	it('are what the history says about an act it would not take', () => {
		expect(wordsFor(new HistoryError('There is nothing new to save.'))).toBe(
			'There is nothing new to save.'
		);
	});

	it('are what a graph written by a newer Sloppy says about itself', () => {
		let thrown: unknown;
		try {
			readGraphFile(encodeText(JSON.stringify({ format: VAULT_FORMAT + 1, name: 'Thesis' })));
		} catch (error) {
			thrown = error;
		}

		expect(wordsFor(thrown)).toBe(
			'This graph was written by a newer Sloppy. Update and open it again.'
		);
	});

	// The path a check refused is the reader's own business and nobody else's,
	// and it is the whole of what this error says.
	it('are never a path check’s account of itself', () => {
		const refused = new OutsideRootError('../secrets');

		expect(wordsFor(refused)).toBeUndefined();
		expect(refusal(refused, 'That file could not be read.').message).toBe(
			'That file could not be read.'
		);
	});

	it('are never the inside of a bug', () => {
		expect(wordsFor(new Error("Cannot read properties of undefined (reading 'invoke')"))).toBe(
			undefined
		);
		expect(wordsFor(new TypeError('x is not a function'))).toBeUndefined();
	});

	it('leave a refusal carrying the surface’s own line where nothing wrote any', () => {
		const made = refusal(new Error('a bug in a component'), 'That did not work. Try again.');

		expect(made).toBeInstanceOf(Refusal);
		expect(made.message).toBe('That did not work. Try again.');
	});
});
