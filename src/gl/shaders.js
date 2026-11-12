// GLSL for the particle engine. PHYSICS_VS runs once per particle per frame
// with transform feedback (output written straight back into a GPU buffer, no
// CPU round trip). Its maths mirrors src/logic/physics.js exactly.

export const PHYSICS_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_vel;
layout(location = 2) in vec4 a_target;   // xyz = model position, w = part index
layout(location = 3) in vec4 a_seed;     // per-particle random numbers in [0, 1)

uniform int uMode;            // 0 dormant, 1 cloud, 2 formed
uniform float uDt;
uniform float uTime;
uniform float uExplode;
uniform float uBeat;
uniform float uAttract;       // 1 when a hand is steering the cloud
uniform vec3 uAttractor;      // in model space
uniform vec4 uRules[12];       // per part: explode direction (xyz) and spread (w)
uniform vec3 uCenters[12];     // per part: centre of mass

out vec3 v_pos;
out vec3 v_vel;

void main() {
  vec3 p = a_pos;
  vec3 v = a_vel;
  vec4 s = a_seed;
  vec3 acc;
  float damp;

  if (uMode == 0) {
    vec3 home = normalize(s.yzw * 2.0 - 1.0 + vec3(1e-3)) * (4.5 + 3.0 * s.x);
    acc = (home - p) * 0.6;
    damp = 1.2;
  } else if (uMode == 1) {
    vec3 c = uAttractor * uAttract;
    vec3 rel = p - c;
    float r = length(rel) + 1e-4;
    float R = 0.55 + 0.4 * s.x;
    float pull = (r - R) * 7.0;
    float swirl = 1.5 * (0.6 + s.y) / r;
    acc = -rel / r * pull
        + vec3(rel.z, 0.0, -rel.x) * swirl
        + vec3(sin(uTime * 1.3 + s.y * 20.0 + p.y * 3.0),
               sin(uTime * 1.1 + s.z * 20.0 + p.z * 3.0),
               sin(uTime * 0.9 + s.w * 20.0 + p.x * 3.0)) * 0.8;
    damp = 2.0;
  } else {
    int part = int(a_target.w + 0.5);
    vec4 rule = uRules[part];
    vec3 T = a_target.xyz * uBeat + uExplode * (rule.xyz + rule.w * (a_target.xyz - uCenters[part]));
    float k = 18.0 + (40.0 - 18.0) * s.x;
    acc = (T - p) * k
        + vec3(sin(uTime * 2.0 + s.y * 30.0),
               sin(uTime * 2.3 + s.z * 30.0),
               sin(uTime * 1.7 + s.w * 30.0)) * 0.03;
    damp = 7.0;
  }

  float dt = min(uDt, 1.0 / 30.0);
  v = (v + acc * dt) * exp(-damp * dt);
  p += v * dt;

  v_pos = p;
  v_vel = v;
}
`;

// Transform feedback still needs a fragment shader to link; nothing is drawn.
export const PHYSICS_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }
`;

export const RENDER_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_vel;
layout(location = 2) in vec4 a_target;
layout(location = 3) in vec4 a_seed;

uniform mat4 uProj;
uniform mat4 uView;
uniform mat3 uRot;
uniform vec3 uColors[12];
uniform float uPointSize;
uniform float uAlpha;
uniform float uCloudMix;     // 0 = part colours, 1 = cloud palette
uniform float uDpr;
uniform float uTime;
uniform int uHighlight;      // part to brighten, -1 for none

out vec3 v_color;
out float v_alpha;

void main() {
  vec4 viewPos = uView * vec4(uRot * a_pos, 1.0);
  gl_Position = uProj * viewPos;

  int part = int(a_target.w + 0.5);
  vec3 base = uColors[part];
  vec3 cloud = mix(vec3(0.35, 0.75, 1.0), vec3(0.85, 0.45, 1.0), a_seed.y);
  cloud = mix(cloud, vec3(1.0, 0.8, 0.5), step(0.93, a_seed.z));
  vec3 col = mix(base, cloud, uCloudMix);

  // Fast particles burn white-hot.
  col = mix(col, vec3(1.0), clamp(length(a_vel) * 0.08, 0.0, 0.55));

  float glow = (uHighlight == part) ? 1.9 : 1.0;
  float twinkle = 0.78 + 0.22 * sin(uTime * 3.0 + a_seed.w * 40.0);
  v_color = col * glow;
  v_alpha = uAlpha * twinkle;

  gl_PointSize = uPointSize * uDpr * (0.6 + 0.8 * a_seed.x) / max(-viewPos.z, 0.1);
}
`;

export const RENDER_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.5) * v_alpha;
  o = vec4(v_color * a, a);   // premultiplied, drawn with additive blending
}
`;

// Full-screen triangle used to fade the previous frame (motion trails).
export const FADE_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FADE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform float uFade;
out vec4 o;
void main() { o = vec4(0.0, 0.0, 0.0, uFade); }
`;
