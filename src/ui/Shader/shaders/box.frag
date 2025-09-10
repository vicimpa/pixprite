#version 300 es
precision lowp float;

in vec2 fragCoord;
out vec4 fragColor;

//frag
void mainFrag(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(fragCoord, 0, 1);
}
//frag

void main() {
  mainFrag(fragColor, fragCoord);
}