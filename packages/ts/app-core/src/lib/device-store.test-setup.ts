// Ahead of every case in this package's suite: a case reads the graph its own
// routes answer with, never one a case before it left on the device.

import { beforeEach } from 'vitest';
import { deviceStore } from './device-store.js';
import { DID } from './stores/fake-api.test-support.js';

beforeEach(async () => {
	await deviceStore.forget(DID);
});
