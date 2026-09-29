// The element kinds every surface that draws a note registers the same way,
// because they need nothing from the surface to draw themselves — and the
// colour on the code inside them, for the same reason. A kind that has to be
// handed a capability — a picture its store, an emoji its catalog — stays a
// registration of its own.

import { DiagramNode } from './diagram-node.js';
import { Highlighting } from './highlight.js';
import { MathBlockNode, MathNode } from './math-node.js';

export const DRAWN_ELEMENTS = [MathNode, MathBlockNode, DiagramNode, Highlighting];
