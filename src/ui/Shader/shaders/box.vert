#version 300 es
precision lowp float;

out vec2 fragCoord;

void main() {
  int id = gl_VertexID;
  int x = int(id & 1);
  int y = int(id > 1);
  fragCoord = vec2(x, y);
  gl_Position = vec4(fragCoord * 2.0 - 1.0, 0, 1);
}