import { MemoryFiles } from '@sloppy/local';
import { describe, expect, it } from 'vitest';
import { deviceAiKeys } from './ai-keys';
import type { Invoke } from './files';

/** The plugin as this shell reaches it: it seals by reversing, and remembers
 *  what it was asked. */
function plugin(): { call: Invoke; asked: string[] } {
	const asked: string[] = [];
	const kept = new Map<string, string>();
	const call = (async (command: string, args?: Record<string, unknown>) => {
		const payload = (args?.payload ?? {}) as Record<string, string>;
		asked.push(`${command} ${payload.identifier}`);
		switch (command) {
			case 'plugin:crypto-hw|seal': {
				const sealed = [...payload.plaintext].reverse().join('');
				kept.set(payload.identifier, sealed);
				return { sealed, backing: 'hardware' };
			}
			case 'plugin:crypto-hw|open':
				return { plaintext: [...payload.sealed].reverse().join(''), backing: 'hardware' };
			case 'plugin:crypto-hw|delete':
				return { deleted: kept.delete(payload.identifier) };
			default:
				throw new Error(`no such command: ${command}`);
		}
	}) as Invoke;
	return { call, asked };
}

describe('the keys this device holds for an assistant', () => {
	it('writes one down sealed, says who has one, and opens it only when asked', async () => {
		const files = new MemoryFiles({ root: '/device', store: new Map(), data: '/data' });
		const { call, asked } = plugin();
		const keys = deviceAiKeys(files, call);

		expect(await keys.hold('anthropic', 'sk-ant-secret')).toBe('hardware');
		expect(await keys.held()).toEqual([{ provider: 'anthropic', backing: 'hardware' }]);

		const written = new TextDecoder().decode(
			await files.at(await files.dataPath()).read('ai-keys.json')
		);
		expect(written).not.toContain('sk-ant-secret');

		expect(await keys.open('anthropic')).toBe('sk-ant-secret');
		expect(asked).toEqual([
			'plugin:crypto-hw|seal sloppy.ai.anthropic',
			'plugin:crypto-hw|open sloppy.ai.anthropic'
		]);
	});

	it('takes the sealed key away with the one it was kept under', async () => {
		const files = new MemoryFiles({ root: '/device', store: new Map(), data: '/data' });
		const { call, asked } = plugin();
		const keys = deviceAiKeys(files, call);
		await keys.hold('openai', 'sk-open');

		await keys.forget('openai');

		expect(await keys.held()).toEqual([]);
		expect(asked.at(-1)).toBe('plugin:crypto-hw|delete sloppy.ai.openai');
	});
});
