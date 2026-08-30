import { afterEach } from 'vitest';

// bits-ui's scroll lock resets the body style from a timer rather than on
// unmount, so a modal closed at the end of a file can still have one pending
// when vitest disposes the jsdom environment — and `document` is gone by the
// time it fires, which surfaces as an unhandled error rather than a failure.
// One macrotask lets it run while the document is still there.
afterEach(async () => {
	await new Promise((done) => setTimeout(done, 0));
});
