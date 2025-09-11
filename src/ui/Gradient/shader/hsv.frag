uniform vec4 a, b, c, d;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainFrag(out vec4 fragColor, in vec2 uv) {
  vec4 top = mix(a, b, uv.x);
  vec4 bottom = mix(c, d, uv.x);
  vec4 current = mix(top, bottom, uv.y);
  fragColor = vec4(hsv2rgb(current.xyz), current.w);
}
