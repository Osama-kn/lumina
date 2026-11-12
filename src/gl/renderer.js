// Hand-written WebGL2 particle engine. Particle state (position + velocity)
// lives in two GPU buffers that ping-pong: each frame the physics shader reads
// one and writes the other through transform feedback, then the render pass
// draws the fresh positions as additive glowing points. The CPU never touches
// per-particle data after setup, which is what makes 200k+ particles cheap.

import { PHYSICS_VS, PHYSICS_FS, RENDER_VS, RENDER_FS, FADE_VS, FADE_FS } from './shaders.js';
import { mulberry32 } from '../models/geometry.js';
import { MAX_PARTS } from '../models/core.js';
import { perspective, translation } from '../lib/mat.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function program(gl, vs, fs, feedback) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  if (feedback) gl.transformFeedbackVaryings(p, feedback, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

export class ParticleRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{count:number, dpr?:number, trails?:boolean, seed?:number}} opts
   */
  constructor(canvas, { count, dpr = Math.min(window.devicePixelRatio || 1, 2), trails = true, seed = 7 }) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true, // needed for trails (we fade instead of clearing)
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.count = count;
    this.dpr = dpr;
    this.trails = trails;
    this.distance = 4.2;
    this.fovY = (45 * Math.PI) / 180;

    this.physics = program(gl, PHYSICS_VS, PHYSICS_FS, ['v_pos', 'v_vel']);
    this.render = program(gl, RENDER_VS, RENDER_FS);
    this.fade = program(gl, FADE_VS, FADE_FS);

    // Static per-particle data: random seeds, and model targets (rewritten on model change).
    const rng = mulberry32(seed);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
    this.seeds = seeds;

    // Start every particle at its dormant home, so the first snap pulls them in from afar.
    const state = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const s = seeds.subarray(i * 4, i * 4 + 4);
      let x = s[1] * 2 - 1 + 1e-3, y = s[2] * 2 - 1 + 1e-3, z = s[3] * 2 - 1 + 1e-3;
      const l = Math.hypot(x, y, z), R = 4.5 + 3.0 * s[0];
      state.set([(x / l) * R, (y / l) * R, (z / l) * R, 0, 0, 0], i * 6);
    }

    this.seedBuf = this.buffer(seeds, gl.STATIC_DRAW);
    this.targetBuf = this.buffer(new Float32Array(count * 4), gl.DYNAMIC_DRAW);
    this.stateBufs = [this.buffer(state, gl.DYNAMIC_COPY), this.buffer(state, gl.DYNAMIC_COPY)];
    this.vaos = this.stateBufs.map((b) => this.vao(b));
    this.tf = gl.createTransformFeedback();
    this.cur = 0;

    this.partColors = new Float32Array(MAX_PARTS * 3);
    this.partRules = new Float32Array(MAX_PARTS * 4);
    this.partCenters = new Float32Array(MAX_PARTS * 3);

    this.resize();
  }

  buffer(data, usage) {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return b;
  }

  vao(stateBuf) {
    const gl = this.gl;
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.targetBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return v;
  }

  /** Upload a model built by buildModel() plus its part uniforms. */
  setModel(model, { colors, rules }) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.targetBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, model.target);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.partColors.set(colors);
    this.partRules.set(rules);
    this.partCenters.set(model.centers);
  }

  resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.clear();
    }
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.012, 0.012, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** World-space half extents of the view at the model's depth (z = 0). */
  viewHalfExtents() {
    const halfH = this.distance * Math.tan(this.fovY / 2);
    return { halfW: halfH * (this.canvas.width / this.canvas.height), halfH };
  }

  /**
   * Run the physics shader once.
   * @param {object} u mode (0|1|2), dt, time, explode, beat, attract, attractor [x,y,z]
   */
  step(u) {
    const gl = this.gl;
    const { p, u: loc } = this.physics;
    gl.useProgram(p);
    gl.uniform1i(loc.uMode, u.mode);
    gl.uniform1f(loc.uDt, u.dt);
    gl.uniform1f(loc.uTime, u.time);
    gl.uniform1f(loc.uExplode, u.explode);
    gl.uniform1f(loc.uBeat, u.beat);
    gl.uniform1f(loc.uAttract, u.attract);
    gl.uniform3fv(loc.uAttractor, u.attractor);
    gl.uniform4fv(loc.uRules, this.partRules);
    gl.uniform3fv(loc.uCenters, this.partCenters);

    const next = 1 - this.cur;
    gl.bindVertexArray(this.vaos[this.cur]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.stateBufs[next]);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(null);
    this.cur = next;
  }

  /**
   * Draw the current particle state.
   * @param {object} v rot (mat3), alpha, cloudMix, time, highlight, pointSize
   */
  draw(v) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.trails) {
      // Darken what's already there instead of clearing: moving particles leave short streaks.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fade.p);
      gl.uniform1f(this.fade.u.uFade, 0.32);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      this.clear();
    }

    const { p, u: loc } = this.render;
    gl.useProgram(p);
    const aspect = this.canvas.width / this.canvas.height;
    gl.uniformMatrix4fv(loc.uProj, false, perspective(this.fovY, aspect, 0.05, 60));
    gl.uniformMatrix4fv(loc.uView, false, translation(0, 0, -this.distance));
    gl.uniformMatrix3fv(loc.uRot, false, v.rot);
    gl.uniform3fv(loc.uColors, this.partColors);
    gl.uniform1f(loc.uPointSize, v.pointSize);
    gl.uniform1f(loc.uAlpha, v.alpha);
    gl.uniform1f(loc.uCloudMix, v.cloudMix);
    gl.uniform1f(loc.uDpr, this.dpr);
    gl.uniform1f(loc.uTime, v.time);
    gl.uniform1i(loc.uHighlight, v.highlight ?? -1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive: overlapping particles glow brighter
    gl.bindVertexArray(this.vaos[this.cur]);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  /** Read back particle state (positions + velocities). Slow: tests and debugging only. */
  readState(first = 0, n = this.count) {
    const gl = this.gl;
    const out = new Float32Array(n * 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBufs[this.cur]);
    gl.getBufferSubData(gl.ARRAY_BUFFER, first * 24, out);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return out;
  }

  /** Overwrite particle state for a range (tests). */
  writeState(data, first = 0) {
    const gl = this.gl;
    for (const b of this.stateBufs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferSubData(gl.ARRAY_BUFFER, first * 24, data);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
