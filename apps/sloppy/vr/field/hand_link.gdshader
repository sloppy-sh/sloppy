// A hand link's dashes, laid where its two marks stood when they were last
// dashed and carried with them since: `field/lines.gd` keeps each link's ends,
// then and now, in `ends`, and each vertex names its link in UV.x.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform vec4 ink : source_color;
uniform sampler2D ends : filter_nearest;
// `ACROSS` in `field/lines.gd`.
uniform int across = 1024;

vec3 end_at(int texel) {
	return texelFetch(ends, ivec2(texel % across, texel / across), 0).rgb;
}

// `p` turned by the shortest turn that takes the direction `from` to `to`, both unit.
vec3 turned(vec3 p, vec3 from, vec3 to) {
	float c = dot(from, to);
	vec3 k = cross(from, to);
	if (c < -0.9999) {
		vec3 side = abs(from.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
		vec3 axis = normalize(cross(from, side));
		return 2.0 * dot(axis, p) * axis - p;
	}
	return p * c + cross(k, p) + k * dot(k, p) / (1.0 + c);
}

void vertex() {
	int link = int(UV.x + 0.5) * 4;
	vec3 was_from = end_at(link);
	vec3 was_to = end_at(link + 1);
	vec3 now_from = end_at(link + 2);
	vec3 now_to = end_at(link + 3);
	vec3 was = was_to - was_from;
	vec3 now = now_to - now_from;
	float was_long = length(was);
	vec3 off = VERTEX - was_from;
	if (was_long > 1e-6 && length(now) > 1e-6) {
		off = turned(off, was / was_long, normalize(now)) * (length(now) / was_long);
	}
	VERTEX = now_from + off;
}

void fragment() {
	ALBEDO = ink.rgb;
	ALPHA = ink.a;
}
