// The Godot project around this package would otherwise scan, and import the
// fonts and pictures in, every dependency installed here.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("node_modules", { recursive: true });
writeFileSync("node_modules/.gdignore", "");
