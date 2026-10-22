#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform vec4 iMouse;
uniform float iTime;
uniform float iFrame;

void mainFrag(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(fragCoord, 0, 1);
}