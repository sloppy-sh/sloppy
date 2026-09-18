// Everything a surface read about the graph that was in front of somebody,
// given up: the graph has been swapped for another, or nobody is signed in any
// more, and nothing held belongs to what comes next.

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

export function letGoOfWhatWasRead(): void {
	graphHistory.clear();
	gitSettings.clear();
	nodes.clear();
	offers.clear();
	outlineSections.clear();
	deleted.clear();
	graphs.clear();
	tags.clear();
	peers.clear();
	find.clear();
	people.hold(null);
	publications.clear();
	conversation.clear();
	identity.clear();
}
