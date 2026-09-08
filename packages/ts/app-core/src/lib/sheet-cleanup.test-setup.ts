// After the last case in a file: the sheet library restores the page's scroll
// lock on a 24 ms timer, which under a busy suite can fire after this file's
// document is gone and surface as an unhandled error. Outlive it.

import { afterAll } from 'vitest';

afterAll(() => new Promise((done) => setTimeout(done, 60)));
