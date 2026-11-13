// A note's picture worn on its mark as a disc turned to the reader, in front of
// the sphere, edged in the mark's own colour, and broken where the mark is pulled
// — DESIGN.md § "The field in a room".
shader_type spatial;
// Blended while it comes up or goes, and writing depth all the while, so where
// two discs cross the nearer is in front whichever is drawn first.
render_mode unshaded, cull_disabled, blend_mix, depth_draw_always;

uniform sampler2D picture : source_color, filter_linear_mipmap;
// The share of the picture's width and height the square in its middle takes.
uniform vec2 crop = vec2(1.0);
uniform vec3 paper : source_color;
uniform vec3 rim : source_color;
// A pulled note's: the rim is broken into as many dashes as the mark's own edge.
uniform bool broken = false;
uniform float dashes = 14.0;
// In the quad's own units: how far toward the reader it stands off the mark's middle.
uniform float lift = 0.0;
// How far the picture has come up on its mark, 0 to 1.
uniform float alpha = 1.0;

void vertex() {
	VERTEX.z += lift;
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
		INV_VIEW_MATRIX[0] * length(MODEL_MATRIX[0].xyz),
		INV_VIEW_MATRIX[1] * length(MODEL_MATRIX[1].xyz),
		INV_VIEW_MATRIX[2] * length(MODEL_MATRIX[2].xyz),
		MODEL_MATRIX[3]);
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
}

void fragment() {
	vec2 off = UV * 2.0 - 1.0;
	float away = length(off);
	bool on_rim = away > 0.9;
	if (away > 1.0 || (on_rim && broken && fract(atan(off.y, off.x) / TAU * dashes) >= 0.5)) {
		discard;
	}
	vec4 seen = texture(picture, 0.5 + (UV - 0.5) * crop);
	ALBEDO = on_rim ? rim : mix(paper, seen.rgb, seen.a);
	ALPHA = alpha;
}
