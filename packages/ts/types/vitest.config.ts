import { defineConfig } from "vitest/config";

// The property suites here — addresses assigned across peers above all — walk
// hundreds of generated graphs per test, and a brief is composed to its budget
// over a two-hundred-note neighbourhood. Run beside every other package's suite
// on a shared runner those have taken up to nine seconds, well past the
// five-second default, so the whole package gets the longer bound rather than
// whichever tests lost the lottery last.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
