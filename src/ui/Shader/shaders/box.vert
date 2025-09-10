#version 300 es
precision highp float;

out vec2 fragCoord;

void main() {
  int id = gl_VertexID;
  fragCoord = vec2(id & 1, id > 1);
  gl_Position = vec4(fragCoord * 2.0 - 1.0, 0, 1);
}