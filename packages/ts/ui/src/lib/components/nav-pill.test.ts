// @vitest-environment jsdom
import HouseIcon from '@lucide/svelte/icons/house';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from './dom.test-support.js';
import type { Person } from './identity/person.js';
import NavPill, { type NavPillProps } from './nav-pill.svelte';

const ITEMS = [
	{ id: 'graph', label: 'Graph', href: '/', icon: HouseIcon },
	{ id: 'settings', label: 'Settings', href: '/settings', icon: HouseIcon }
];

const ADA: Person = {
	displayName: 'Ada Lovelace',
	handle: 'ada',
	bio: null,
	avatar: '/api/proxy?ref=avatar',
	banner: null
};

const you = (nav: HTMLElement) =>
	[...nav.querySelectorAll('a')].find((link) => link.textContent?.includes('You'));

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function render(props: Partial<NavPillProps> = {}) {
	mounted = mount(NavPill, { target, props: { items: ITEMS, ...props } });
	flushSync();
	return target.querySelector('nav') as HTMLElement;
}

const inset = () => document.documentElement.style.getPropertyValue('--sysnav-inset-bottom');

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.documentElement.style.removeProperty('--sysnav-inset-bottom');
});

describe('the nav pill', () => {
	it('publishes the space it takes, so bottom-pinned surfaces can clear it', () => {
		const nav = render();
		expect(inset()).toBe(`${nav.offsetHeight + 16}px`);
	});

	it('takes the space back when it goes', () => {
		render();
		unmount(mounted!, { outro: false });
		mounted = undefined;
		flushSync();
		expect(inset()).toBe('');
	});

	it('reserves nothing while the keyboard owns the bottom of the screen', () => {
		render({ keyboardOpen: true });
		expect(inset()).toBe('');
	});

	it('reserves nothing while a modal is up', () => {
		const nav = render({ suppressed: true });
		expect(inset()).toBe('');
		expect(nav.inert).toBe(true);
	});

	it('marks the destination the reader is on', () => {
		render({ activeId: 'settings' });
		const current = target.querySelector('[aria-current="page"]');
		expect(current?.textContent).toContain('Settings');
	});

	it('gives every target a reachable size', () => {
		const nav = render();
		for (const link of nav.querySelectorAll('a')) {
			expect(link.className).toContain('min-h-11');
		}
	});

	it('shows the person on their own destination instead of a glyph', () => {
		stubMediaQuery(() => false);
		const nav = render({
			items: [
				...ITEMS,
				{ id: 'profile', label: 'You', href: '/profile', icon: HouseIcon, person: ADA }
			]
		});
		expect(you(nav)?.querySelector('img')?.src).toContain('ref=avatar');
		expect(you(nav)?.querySelector('svg')).toBeNull();
	});

	it('falls back to their initials, not to the glyph, before they choose a picture', () => {
		stubMediaQuery(() => false);
		const nav = render({
			items: [
				...ITEMS,
				{
					id: 'profile',
					label: 'You',
					href: '/profile',
					icon: HouseIcon,
					person: { ...ADA, avatar: null }
				}
			]
		});
		expect(you(nav)?.textContent).toContain('AL');
		expect(you(nav)?.querySelector('svg')).toBeNull();
	});

	it('draws an action beside the destinations only when there is one', () => {
		expect(render().querySelector('button')).toBeNull();
		unmount(mounted!, { outro: false });
		const withAction = render({
			action: { label: 'Add', icon: HouseIcon, onSelect: () => {} }
		});
		expect(withAction.querySelector('button')?.textContent).toContain('Add');
	});
});
