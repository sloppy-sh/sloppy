// The night room's sky — DESIGN.md § "The field in a room". The stars stand in
// a grid of cells round the reader, one or none to a cell, kept to the cell's
// middle and to the sphere the grid is read on so no star is cut by its cell's
// edge. The drift is the environment's sky rotation rather than TIME here, so
// the sky's light is not worked out again every frame.
shader_type sky;

uniform vec3 paper : source_color = vec3(0.016);
// Cells across the sphere's radius: about 3,000 stars over the whole sky.
uniform float cells = 40.0;
uniform vec3 band_normal = vec3(0.32, 0.86, 0.40);
uniform float band_width = 0.2;
uniform float brightness = 0.55;

vec3 hash3(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

float band(vec3 eye) {
	float across = dot(eye, normalize(band_normal)) / band_width;
	return exp(-across * across);
}

vec3 star(vec3 eye, float near_band) {
	vec3 at = eye * cells;
	vec3 cell = floor(at);
	vec3 chance = hash3(cell);
	if (chance.x > 0.42 + 0.3 * near_band) {
		return vec3(0.0);
	}
	vec3 placed = cell + 0.25 + 0.5 * hash3(cell + 17.0);
	if (abs(length(placed) - cells) > 0.15) {
		return vec3(0.0);
	}
	float size = chance.y < 0.7 ? 0.035 : (chance.y < 0.95 ? 0.05 : 0.075);
	float lit = 1.0 - smoothstep(0.0, size, distance(at, normalize(placed) * cells));
	vec3 warmth = mix(vec3(1.0, 0.82, 0.66), vec3(0.74, 0.84, 1.0), chance.z);
	return warmth * lit * (0.35 + size * 8.0);
}

void sky() {
	float near_band = band(EYEDIR);
	vec3 glow = paper + vec3(0.62, 0.66, 0.8) * 0.035 * near_band;
	if (AT_CUBEMAP_PASS) {
		COLOR = glow;
	} else {
		COLOR = glow + star(EYEDIR, near_band) * brightness;
	}
}
