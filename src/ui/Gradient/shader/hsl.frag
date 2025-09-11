uniform vec4 a, b, c, d;

vec3 hsl2hsv(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  float v = l + s * min(l, 1.0 - l);
  float newS = (v == 0.0) ? 0.0 : 2.0 * (1.0 - l / v);

  return vec3(h, newS, v);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 hsl2rgb(vec3 c) {
  return hsv2rgb(hsl2hsv(c));
}

void mainFrag(out vec4 fragColor, in vec2 uv) {
  vec4 top = mix(a, b, fragCoord.x);
  vec4 bottom = mix(c, d, fragCoord.x);
  vec4 current = mix(top, bottom, fragCoord.y);
  fragColor = vec4(hsl2rgb(current.xyz), current.w);
}