import { afterAll, afterEach } from 'vitest';

// bits-ui's scroll lock restores the body style from a timer 24ms after the
// last modal unmounts, not on unmount, so a file that closes one at the end can
// still have that timer pending when vitest disposes the jsdom environment —
// and `document` is gone by the time it runs, which surfaces as an unhandled
// error rather than a failing test. Draining the queue between tests keeps the
// document alive for it; the wait at the end of the file covers the last one.
afterEach(async () => {
	await new Promise((done) => setTimeout(done, 0));
});

afterAll(async () => {
	await new Promise((done) => setTimeout(done, 60));
});
