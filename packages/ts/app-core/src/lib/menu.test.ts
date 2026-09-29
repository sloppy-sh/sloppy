import { describe, expect, it } from 'vitest';
import { appMenu } from './menu.js';
import { type Act, acts } from './stores/acts.svelte.js';

function act(over: Partial<Act> & Pick<Act, 'id' | 'label' | 'group' | 'where'>): Act {
	return { run: () => {}, ...over };
}

const EVERYTHING: Act[] = [
	act({ id: 'export', label: 'Export this graph', group: 'Graph', where: ['palette', 'menu'] }),
	act({ id: 'import', label: 'Import a graph', group: 'Graph', where: ['palette', 'menu'] }),
	act({ id: 'find', label: 'Find a note, or do something', group: 'Look', where: ['menu'] }),
	act({ id: 'history', label: 'History', group: 'History', where: ['column', 'menu'] }),
	act({ id: 'choose', label: 'Choose notes', group: 'Look', where: ['palette'] })
];

const groupNamed = (label: string) => appMenu().find((one) => one.label === label);
const linesOf = (label: string) => (groupNamed(label)?.lines ?? []).map((line) => line.label);

describe('the app’s own menu', () => {
	it('carries the acts that named it, and never one that did not', () => {
		const stop = acts.offers(EVERYTHING);

		expect(linesOf('File')).toContain('Export this graph');
		expect(linesOf('File')).toContain('Import a graph');
		expect(linesOf('View')).toEqual(['Find a note, or do something', 'History']);
		expect(appMenu().flatMap((one) => one.lines.map((line) => line.label))).not.toContain(
			'Choose notes'
		);
		stop();
	});

	it('leaves the system to spell its own lines', () => {
		const stop = acts.offers(EVERYTHING);

		const own = appMenu()
			.flatMap((one) => one.lines)
			.filter((line) => line.id.startsWith('~'));
		expect(own.length).toBeGreaterThan(0);
		expect(own.every((line) => line.label === '')).toBe(true);
		// The app's own menu is nothing but lines the system names and does.
		expect(groupNamed('Sloppy')?.lines.every((line) => line.id.startsWith('~'))).toBe(true);
		stop();
	});

	it('shows a line the page cannot offer now, and refuses it', () => {
		const stop = acts.offers(EVERYTHING.filter((one) => one.id !== 'export'));

		const file = groupNamed('File')?.lines ?? [];
		expect(file.map((line) => line.label)).not.toContain('Export this graph');
		expect(file.some((line) => line.label === 'Import a graph' && line.enabled)).toBe(true);
		stop();
	});

	it('draws no menu for a group nothing is offered under', () => {
		const stop = acts.offers([]);

		expect(groupNamed('View')).toBeUndefined();
		expect(groupNamed('Sloppy')).toBeDefined();
		stop();
	});
});
