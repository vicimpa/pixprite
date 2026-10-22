#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform vec4 iMouse;
uniform float iTime;
uniform float iFrame;

out vec2 fragCoord;

void main() {
  int id = gl_VertexID;
  fragCoord = vec2(id & 1, id > 1);
  gl_Position = vec4(fragCoord * 2.0 - 1.0, 0, 1);
}