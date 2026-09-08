// @vitest-environment jsdom
// What the sheet tells somebody before it publishes every note they picked out.

import type { Address } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { NamedBranches } from '../publish/terms.js';
import ChosenPublish from './chosen-publish.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function asked(narrower: NamedBranches[], count = 3): string {
	mounted = mount(ChosenPublish, {
		target,
		props: { open: true, count, narrower, onpublish: () => undefined }
	});
	flushSync();
	return document.body.textContent ?? '';
}

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

// A branch nobody numbered has no address to name it by, and it is exactly the
// one a person cannot find any other way.
describe('a narrower branch under the notes going out', () => {
	it('is named by its address where its author wrote one', () => {
		expect(asked([{ address: '1a1' as Address }])).toContain(
			'1a1 is published inviting fewer people to answer. What you publish here carries it on these terms.'
		);
	});

	it('is said in words where its author never numbered it', () => {
		const shown = asked([{ unnumbered: 1 }]);

		expect(shown).toContain(
			'A branch you never numbered is published inviting fewer people to answer. What you publish here carries it on these terms.'
		);
		expect(shown).not.toContain('undefined');
	});

	it('counts several of them together, since none can be cited apart', () => {
		expect(asked([{ address: '1a1' as Address }, { unnumbered: 2 }])).toContain(
			'2 branches you never numbered are published inviting fewer people to answer.'
		);
	});
});
