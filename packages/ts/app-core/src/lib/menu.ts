/**
 * The app's own menu bar, as a description — DESIGN.md § Layout. The words and
 * what each line does are here, with the rest of the product; a shell carries
 * this across and carries an id back, and reads neither.
 *
 * An id beginning `~` is a line the operating system spells and does itself,
 * so its own words are never written here.
 */

import { acts } from './stores/acts.svelte.js';

export interface MenuLine {
	id: string;
	/** Empty on a line the system names itself. */
	label: string;
	/** A line that cannot be taken now is shown and refused, rather than
	 *  disappearing from under somebody looking for it. */
	enabled: boolean;
	/** As the platform spells accelerators, e.g. `CmdOrCtrl+K`. */
	accelerator?: string;
}

export interface MenuGroup {
	label: string;
	lines: MenuLine[];
}

const SEPARATOR: MenuLine = { id: '~separator', label: '', enabled: true };

function own(id: string): MenuLine {
	return { id, label: '', enabled: true };
}

/** One act as a line, disabled where the page offering it has gone. */
function lineFor(id: string, label: string, accelerator?: string): MenuLine {
	return {
		id,
		label,
		enabled: acts.all.some((act) => act.id === id),
		...(accelerator === undefined ? {} : { accelerator })
	};
}

/** What the acts standing now put in the menu, by the group each named. */
function inGroup(...groups: readonly string[]): MenuLine[] {
	return acts.inMenu
		.filter((act) => groups.includes(act.group))
		.map((act) => lineFor(act.id, act.label));
}

/**
 * The menu as it stands. A group with nothing in it is left out, so a surface
 * offering none of a group's acts draws no empty menu.
 */
export function appMenu(): MenuGroup[] {
	const file = [...inGroup('Graph'), SEPARATOR, own('~close')];
	const view = inGroup('Look', 'History');
	return [
		{
			label: 'Sloppy',
			lines: [
				own('~about'),
				SEPARATOR,
				own('~services'),
				SEPARATOR,
				own('~hide'),
				own('~hide-others'),
				SEPARATOR,
				own('~quit')
			]
		},
		{ label: 'File', lines: file },
		{
			label: 'Edit',
			lines: [
				own('~undo'),
				own('~redo'),
				SEPARATOR,
				own('~cut'),
				own('~copy'),
				own('~paste'),
				own('~select-all')
			]
		},
		...(view.length === 0 ? [] : [{ label: 'View', lines: view }]),
		{ label: 'Window', lines: [own('~minimize'), own('~maximize'), own('~fullscreen')] }
	];
}
