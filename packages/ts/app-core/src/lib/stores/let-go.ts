// Everything a surface read about what was in front of somebody, given up: the
// folder or the graph has been swapped for another, or nobody is signed in any
// more, and nothing held belongs to what comes next.

import { chat } from './chat.svelte.js';
import { codeDrift } from './code-drift.svelte.js';
import { conversation } from './conversation.svelte.js';
import { deleted } from './deleted.svelte.js';
import { find } from './find.svelte.js';
import { gitSettings } from './git-settings.svelte.js';
import { graphs } from './graphs.svelte.js';
import { graphHistory } from './history.svelte.js';
import { identity } from './identity.svelte.js';
import { nodes } from './nodes.svelte.js';
import { offers } from './offers.svelte.js';
import { outlineSections } from './outline-sections.svelte.js';
import { peers } from './peers.svelte.js';
import { people } from './people.svelte.js';
import { publications } from './publications.svelte.js';
import { tags } from './tags.svelte.js';

/** For one folder swapped for another in front of the same person: nothing
 *  read out of the folder that was is a copy of anything in this one, however
 *  the graphs in them compare. What the folder's notes are read back as is
 *  `graphs.enterFolder`'s, and how it was being READ is the arriving page's. */
export function letGoOfTheFolderRead(): void {
	graphHistory.clear();
	gitSettings.clear();
	find.clear();
	deleted.clear();
	codeDrift.clear();
	chat.clear();
	tags.clear();
}

/** For one graph swapped for another in front of the same person: what they
 *  keep is read again, and the graph they were in and the ones up beside it
 *  stay this device's choice, because a swap can be swapped back. */
export function letGoOfTheGraphRead(): void {
	graphHistory.clear();
	gitSettings.clear();
	nodes.clear();
	offers.clear();
	outlineSections.clear();
	deleted.clear();
	graphs.forgetTheListing();
	tags.clear();
	peers.clear();
	find.clear();
	people.hold(null);
	publications.clear();
	conversation.clear();
	identity.clear();
}

/** The same, and the choice of graph with it: nobody is signed in any more, or
 *  this app is pointed at another Sloppy, so a saved ref names a graph the
 *  person in front of it does not keep. */
export function letGoOfWhatWasRead(): void {
	letGoOfTheGraphRead();
	graphs.clear();
}
