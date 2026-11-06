export const BACKENDS = ["claude-code", "codex", "api", "mock"];

/** Backends that drive an agent installed on this device, run only where agents.json allows them. */
export const INSTALLED_BACKENDS = ["claude-code", "codex"];

export const TOKEN_CLASSES = [
  "input",
  "cache_write",
  "cache_read",
  "output",
  "reasoning",
];

export const isInstalledBackend = (kind) => INSTALLED_BACKENDS.includes(kind);
