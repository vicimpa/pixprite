#include "base.glsl"

in vec2 fragCoord;
out vec4 fragColor;

void mainFrag(out vec4 fragColor, in vec2 fragCoord);

void main() {
  mainFrag(fragColor, fragCoord);
}