#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform vec4 iMouse;
uniform float iTime;
uniform float iFrame;

in vec2 fragCoord;
out vec4 fragColor;

void mainFrag(out vec4 fragColor, in vec2 fragCoord);

void main() {
  mainFrag(fragColor, fragCoord);
}