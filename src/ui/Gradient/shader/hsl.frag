#include "common.glsl"

void mainFrag(out vec4 fragColor, in vec2 uv) {
  vec4 current = gradient(uv);
  fragColor = vec4(hsl2rgb(current.xyz), current.w);
}
