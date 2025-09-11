uniform vec4 a, b, c, d;

vec3 hsl2rgb(vec3 c) {
  float h = c.x;
  float s = c.y;
  float l = c.z;

  float c1 = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c1 * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c1 / 2.0;

  vec3 rgb;

  if (0.0 <= h && h < 1.0 / 6.0)
    rgb = vec3(c1, x, 0.0);
  else if (1.0 / 6.0 <= h && h < 2.0 / 6.0)
    rgb = vec3(x, c1, 0.0);
  else if (2.0 / 6.0 <= h && h < 3.0 / 6.0)
    rgb = vec3(0.0, c1, x);
  else if (3.0 / 6.0 <= h && h < 4.0 / 6.0)
    rgb = vec3(0.0, x, c1);
  else if (4.0 / 6.0 <= h && h < 5.0 / 6.0)
    rgb = vec3(x, 0.0, c1);
  else
    rgb = vec3(c1, 0.0, x);

  return rgb + vec3(m);
}

void mainFrag(out vec4 fragColor, in vec2 uv) {
  vec4 top = mix(a, b, fragCoord.x);
  vec4 bottom = mix(c, d, fragCoord.x);
  vec4 current = mix(top, bottom, fragCoord.y);
  fragColor = vec4(hsl2rgb(current.xyz), current.w);
}