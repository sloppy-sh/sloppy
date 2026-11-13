// One mark: a matte sphere wearing a band per drawn set it is in, as latitudes
// from the first at the top; a pulled note is a hollow shell whose edge is
// broken and carries its first hue — DESIGN.md § "The field in a room".
// Per instance (marks.gd): COLOR is the depth fill; CUSTOM.x, .y and .z hold the
// slots of bands 1–3, 4–6 and 7–8 as base-9 digits, 0 for none; CUSTOM.w is how
// many bands are worn, 0 for the depth fill, plus 16 for a pulled note. Every
// value stays small enough to survive a half-float channel exactly.
shader_type spatial;
render_mode unshaded, cull_back;

// Linear, in slot order.
uniform vec3 slots[8];
uniform vec3 paper;
uniform float dashes = 14.0;

varying flat vec4 worn;
varying flat vec3 fill;
varying vec3 at;

void vertex() {
	worn = INSTANCE_CUSTOM;
	fill = COLOR.rgb;
	at = normalize(VERTEX);
}

vec3 band(int index) {
	float channel = index < 3 ? worn.x : (index < 6 ? worn.y : worn.z);
	int packed = int(channel + 0.5);
	int place = index % 3;
	int slot = (place == 0 ? packed : (place == 1 ? packed / 9 : packed / 81)) % 9;
	return slot > 0 ? slots[slot - 1] : fill;
}

void fragment() {
	int held = int(worn.w + 0.5);
	int count = held % 16;
	vec3 colour = fill;
	if (count > 0) {
		float down = clamp((1.0 - at.y) * 0.5, 0.0, 0.9999);
		colour = band(int(floor(down * float(count))));
	}
	if (held >= 16) {
		float facing = dot(NORMAL, VIEW);
		float around = atan(NORMAL.y, NORMAL.x) / TAU;
		bool edge = facing < 0.42 && fract(around * dashes) < 0.5;
		colour = edge ? (count > 0 ? band(0) : fill) : paper;
	}
	// Lit from above and nowhere else: a matte body, never a light source.
	ALBEDO = colour * (0.84 + 0.16 * (NORMAL.y * 0.5 + 0.5));
}
