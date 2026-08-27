// @vitest-environment jsdom
// Every vendored primitive mounted once, open where it has a closed state, so a
// bad import or a prop that drifted on upgrade fails here rather than on a
// product screen.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from './dom.test-support.js';
import Primitives from './primitives-harness.test.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

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
});

it('mounts every primitive the vocabulary offers', () => {
	mounted = mount(Primitives, { target });
	flushSync();
	expect(target.querySelector('button')).not.toBeNull();
	expect(target.querySelector('input')).not.toBeNull();
	expect(target.querySelector('textarea')).not.toBeNull();
	expect(document.body.textContent).toContain('Third in the sequence');
	expect(document.body.textContent).toContain('Show addresses');
});
