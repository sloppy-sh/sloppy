import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SignInWithKey from '../components/sign-in-with-key.svelte';
import { type FakeApi, useFakeApi } from '../stores/fake-api.test-support.js';
import { session } from '../stores/session.svelte.js';

const ALICE = 'alice@example.com';
const STATEMENT = [
	'Sloppy sign-in',
	`Signing in as mailto:${ALICE}`,
	'Signing in to https://sloppy.sh',
	'a-token.a-signature'
].join('\n');

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let api: FakeApi;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function show(): void {
	mounted = mount(SignInWithKey, { target });
	flushSync();
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
	const one = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
	if (!one) throw new Error(`Nothing on the page asks for ${id}`);
	return one;
}

function type(id: string, value: string): void {
	const one = field(id);
	one.value = value;
	one.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

async function submit(): Promise<void> {
	const form = target.querySelector('form');
	if (!form) throw new Error('Nothing on the page to send');
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await settle();
}

function offersChallenge(): void {
	api.on('POST /auth/challenge', () => ({
		statement: STATEMENT,
		expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
	}));
}

beforeEach(() => {
	target = document.createElement('div');
	document.body.append(target);
	api = useFakeApi();
	session.clear();
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

describe('signing in with a key of your own', () => {
	it('asks for the address, then shows what to sign', async () => {
		offersChallenge();
		show();

		type('own-key-address', ALICE);
		await submit();

		expect(api.calls).toContain('POST /auth/challenge');
		expect(target.textContent).toContain(`mailto:${ALICE}`);
		expect(target.textContent).toContain('Good once');
	});

	it('signs somebody in with what their key gave back', async () => {
		offersChallenge();
		api.on('POST /auth/answer', () => ({
			token: 'a-credential',
			expires_at: '2099-01-01T00:00:00.000Z',
			viewer: { did: `mailto:${ALICE}` }
		}));
		show();

		type('own-key-address', ALICE);
		await submit();
		type('own-key-signature', '-----BEGIN PGP SIGNATURE-----');
		await submit();

		expect(session.viewer?.did).toBe(`mailto:${ALICE}`);
	});

	// The instance wrote the words; passing them on is the only way somebody
	// learns what to do next.
	it('says what the instance said when it would not take the signature', async () => {
		offersChallenge();
		api.on(
			'POST /auth/answer',
			() =>
				new Response(
					JSON.stringify({ message: 'That signature does not check out for that address.' }),
					{
						status: 401
					}
				)
		);
		show();

		type('own-key-address', ALICE);
		await submit();
		type('own-key-signature', 'not a signature');
		await submit();

		expect(session.viewer).toBeNull();
		expect(target.textContent).toContain('That signature does not check out for that address.');
	});

	it('goes back to the address when somebody starts again', async () => {
		offersChallenge();
		show();

		type('own-key-address', ALICE);
		await submit();
		const again = [...target.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Start again'
		);
		again?.click();
		flushSync();

		expect(field('own-key-address')).toBeTruthy();
	});
});
