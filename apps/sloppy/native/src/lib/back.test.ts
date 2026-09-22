import { beforeEach, describe, expect, it, vi } from 'vitest';

const closeTop = vi.fn<() => boolean>();
vi.mock('@sloppy/ui', () => ({ overlay: { closeTop } }));

const session = { signedIn: false };
vi.mock('@sloppy/app-core', () => ({ session }));

const page = { url: new URL('http://localhost/') };
vi.mock('$app/state', () => ({ page }));

const back = vi.spyOn(history, 'back').mockImplementation(() => {});

const { answerBack } = await import('./back.js');

/** The press MainActivity.kt offers, and whether this refused it. */
function pressBack(): boolean {
	const event = new Event('sloppy:back', { cancelable: true });
	answerBack(event);
	return event.defaultPrevented;
}

describe('the back press', () => {
	beforeEach(() => {
		closeTop.mockReset().mockReturnValue(false);
		session.signedIn = true;
		page.url = new URL('http://localhost/n/did:plc:abc/01J');
		back.mockClear();
	});

	it('closes what is over the page before it moves anybody', () => {
		closeTop.mockReturnValue(true);

		expect(pressBack()).toBe(true);
		expect(back).not.toHaveBeenCalled();
	});

	it('walks back a page when there is one to walk back to', () => {
		expect(pressBack()).toBe(true);
		expect(back).toHaveBeenCalledOnce();
	});

	it('leaves the app from the page a person starts on', () => {
		page.url = new URL('http://localhost/');

		expect(pressBack()).toBe(false);
		expect(back).not.toHaveBeenCalled();
	});

	it('leaves the app rather than going nowhere with nobody signed in', () => {
		session.signedIn = false;

		expect(pressBack()).toBe(false);
		expect(back).not.toHaveBeenCalled();
	});

	it('walks back off settings, which is reached before anybody signs in', () => {
		session.signedIn = false;
		page.url = new URL('http://localhost/settings');

		expect(pressBack()).toBe(true);
		expect(back).toHaveBeenCalledOnce();
	});
});
