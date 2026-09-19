// The half of this package a webview can run: Ed25519 and the DID encoding,
// with no store, no server and no node:crypto behind them. The barrel pulls in
// the rest of the provider, which a browser has no business loading.

export * from "./encoding.js";
export * from "./keys.js";
export * from "./sigil.js";
