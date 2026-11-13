// A made-up note carrying one of each thing the page draws.

export const REF =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P3Q";
export const OTHER_REF =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ8B4D5F6G7H8J9K0M1N2P3R";
export const PICTURE_PATH = "pictures/kettle.png";
export const PICTURE_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEUlEQVR4nGP4z8DwHxkzEAgAqJ4P8VeSGSsAAAAASUVORK5CYII=";

export const MARKDOWN = `# Brewing

Water first, then [the kettle note](sloppy:${REF}), and [[${OTHER_REF}]] after.
See [the grinder](1a2) and [the maker's page](https://example.com/kettle).

## Ratios

| Coffee | Water | Note |
|-------:|:-----:|------|
| 15 g   | 250 g | mild |
| 18 g   | 250 g | full |

\`\`\`ts
const ratio = water / coffee;
\`\`\`

\`\`\`mermaid
graph LR
  Beans --> Grinder --> Kettle
\`\`\`

- [x] Boil
- [ ] Pour

> A quiet cup.

![The kettle](${PICTURE_PATH})
![](notes/ink/sketch.svg)
`;

export const NAMED = { [OTHER_REF]: "Grind size" };
export const PICTURES = { [PICTURE_PATH]: PICTURE_DATA };
