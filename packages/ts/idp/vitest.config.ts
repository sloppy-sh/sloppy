import { defineConfig } from "vitest/config";

// Nearly every test here spends at least one Argon2id password cost, and the
// expensive ones spend four. Run alongside the rest of the workspace's suites
// those have passed the five-second default on machine load alone, so the whole
// package gets the longer bound rather than whichever tests lost the lottery
// last.
export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 20_000 },
});
