const TILE = 32;
const ATLAS_DIM = 4096;
const ATLAS_COLS = ATLAS_DIM / TILE;
export const ATLAS_SLOTS = ATLAS_COLS * ATLAS_COLS;

const VERT_SRC = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in vec2 aUV;
layout(location=3) in float aTint;
layout(location=4) in float aSpawn;
layout(location=5) in float aZone;
uniform vec2 uCam;
uniform float uScale;
uniform float uSnap;
uniform vec2 uViewport;
uniform vec2 uFloorOffset;
out vec2 vUV;
out vec2 vSlot;
out float vTint;
out float vSpawn;
out float vZone;
const float T = ${TILE.toFixed(1)};
const float A = ${ATLAS_DIM.toFixed(1)};
void main() {
	vec2 world = aPos + aCorner * T + uFloorOffset;
	vec2 sp = (world - uCam) * uScale;
	vec2 screen = mix(sp, floor(sp + 0.5), uSnap);
	vec2 clip = (screen / uViewport) * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	vUV = aUV + aCorner * (T / A);
	vSlot = aUV;
	vTint = aTint;
	vSpawn = aSpawn;
	vZone = aZone;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vSlot;
in float vTint;
in float vSpawn;
in float vZone;
uniform sampler2D uAtlas;
uniform float uScale;
out vec4 frag;
const float T = ${TILE.toFixed(1)};
const float A = ${ATLAS_DIM.toFixed(1)};
void main() {
	vec2 texel = vUV * A;
	vec2 slotO = vSlot * A;
	vec2 lo = slotO + 0.5;
	vec2 hi = slotO + (T - 0.5);
	vec4 c;
	if (uScale >= 1.0) {
		vec2 cd = fract(texel) - 0.5;
		vec2 region = vec2(0.5 - 0.5 / uScale);
		vec2 mt = floor(texel) + (cd - clamp(cd, -region, region)) * uScale + 0.5;
		c = texture(uAtlas, clamp(mt, lo, hi) / A);
	} else {
		float inv = 1.0 / uScale;
		if (abs(inv - floor(inv + 0.5)) < 0.01) {
			c = texture(uAtlas, clamp(floor(texel) + 0.5, lo, hi) / A);
		} else {
			float h = 0.25 / uScale;
			c = 0.25 * (
				texture(uAtlas, clamp(texel + vec2(-h, -h), lo, hi) / A) +
				texture(uAtlas, clamp(texel + vec2(h, -h), lo, hi) / A) +
				texture(uAtlas, clamp(texel + vec2(-h, h), lo, hi) / A) +
				texture(uAtlas, clamp(texel + vec2(h, h), lo, hi) / A)
			);
		}
	}
	if (c.a < 0.01) discard;
	vec3 col = c.rgb * vec3(1.0, vSpawn, vSpawn);
	int zf = int(vZone + 0.5);
	if ((zf & 256) != 0) { col.r *= 0.35; col.g *= 0.45; }
	if ((zf & 512) != 0) { col.r *= 0.35; col.g *= 0.45; }
	if ((zf & 1024) != 0) { col.r *= 0.15; col.g = min(col.g * 0.9, 1.0); col.b = min(col.b * 1.4, 1.0); }
	if ((zf & 1) != 0 && (zf & 1792) == 0) { col.r *= 0.5; col.b *= 0.5; }
	if ((zf & 16) != 0) { col.g = col.r * 0.25; col.b *= 0.66796875; }
	if ((zf & 8) != 0) { col.b *= 0.5; }
	if ((zf & 4) != 0) { col.g *= 0.5; }
	frag = vec4(mix(col, vec3(0.0), vTint * 0.45), c.a);
}`;

const GHOST_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vSlot;
in float vSpawn;
uniform sampler2D uAtlas;
uniform float uAlpha;
out vec4 frag;
const float T = ${TILE.toFixed(1)};
const float A = ${ATLAS_DIM.toFixed(1)};
void main() {
	vec2 lo = vSlot * A + 0.5;
	vec2 hi = vSlot * A + (T - 0.5);
	vec4 c = texture(uAtlas, clamp(vUV * A, lo, hi) / A);
	if (c.a < 0.01) discard;
	frag = vec4(c.rgb * vec3(1.0, vSpawn, vSpawn), c.a * uAlpha);
}`;

const DIM_VERT_SRC = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const DIM_FRAG_SRC = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 frag;
void main() {
	frag = uColor;
}`;

const FLOATS_PER_INSTANCE = 7;
const INSTANCE_STRIDE = FLOATS_PER_INSTANCE * 4;

export function slotUV(slot: number): { u0: number; v0: number } {
  const col = slot % ATLAS_COLS;
  const row = Math.floor(slot / ATLAS_COLS);
  return { u0: (col * TILE) / ATLAS_DIM, v0: (row * TILE) / ATLAS_DIM };
}

interface ChunkMesh {
  buffer: WebGLBuffer;
  count: number;
}

export class GLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;
  private atlas: WebGLTexture;
  private uCam: WebGLUniformLocation;
  private uScale: WebGLUniformLocation;
  private uSnap: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uFloorOffset: WebGLUniformLocation;
  private dimProgram: WebGLProgram;
  private dimVao: WebGLVertexArrayObject;
  private uDimColor: WebGLUniformLocation;
  private hlVao: WebGLVertexArrayObject;
  private hlBuffer: WebGLBuffer;
  private ghostProgram: WebGLProgram;
  private ghostCam: WebGLUniformLocation;
  private ghostScale: WebGLUniformLocation;
  private ghostSnap: WebGLUniformLocation;
  private ghostViewport: WebGLUniformLocation;
  private ghostFloorOffset: WebGLUniformLocation;
  private ghostAlpha: WebGLUniformLocation;
  private bufW = 0;
  private bufH = 0;
  private meshes = new Map<string, ChunkMesh>();

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    this.program = this.link(VERT_SRC, FRAG_SRC);
    this.uCam = gl.getUniformLocation(this.program, 'uCam')!;
    this.uScale = gl.getUniformLocation(this.program, 'uScale')!;
    this.uSnap = gl.getUniformLocation(this.program, 'uSnap')!;
    this.uViewport = gl.getUniformLocation(this.program, 'uViewport')!;
    this.uFloorOffset = gl.getUniformLocation(this.program, 'uFloorOffset')!;

    this.dimProgram = this.link(DIM_VERT_SRC, DIM_FRAG_SRC);
    this.uDimColor = gl.getUniformLocation(this.dimProgram, 'uColor')!;
    this.dimVao = gl.createVertexArray()!;

    this.ghostProgram = this.link(VERT_SRC, GHOST_FRAG_SRC);
    this.ghostCam = gl.getUniformLocation(this.ghostProgram, 'uCam')!;
    this.ghostScale = gl.getUniformLocation(this.ghostProgram, 'uScale')!;
    this.ghostSnap = gl.getUniformLocation(this.ghostProgram, 'uSnap')!;
    this.ghostViewport = gl.getUniformLocation(this.ghostProgram, 'uViewport')!;
    this.ghostFloorOffset = gl.getUniformLocation(this.ghostProgram, 'uFloorOffset')!;
    this.ghostAlpha = gl.getUniformLocation(this.ghostProgram, 'uAlpha')!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);

    this.hlVao = gl.createVertexArray()!;
    this.hlBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.hlVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hlBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INSTANCE_STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, INSTANCE_STRIDE, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, INSTANCE_STRIDE, 20);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    this.atlas = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_DIM, ATLAS_DIM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader compile failed: ${log}`);
      }
      return sh;
    };
    const program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  uploadSprite(slot: number, rgba: Uint8Array) {
    const gl = this.gl;
    const col = slot % ATLAS_COLS;
    const row = Math.floor(slot / ATLAS_COLS);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, col * TILE, row * TILE, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  setChunkMesh(key: string, data: Float32Array) {
    const gl = this.gl;
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = { buffer: gl.createBuffer()!, count: 0 };
      this.meshes.set(key, mesh);
    }
    mesh.count = data.length / FLOATS_PER_INSTANCE;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  hasChunkMesh(key: string): boolean {
    return this.meshes.has(key);
  }

  deleteChunkMesh(key: string) {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.gl.deleteBuffer(mesh.buffer);
    this.meshes.delete(key);
  }

  beginFrame(bufW: number, bufH: number, camX: number, camY: number, scale: number, snap: number) {
    const gl = this.gl;
    this.bufW = bufW;
    this.bufH = bufH;
    gl.viewport(0, 0, bufW, bufH);
    gl.clearColor(0x11 / 255, 0x15 / 255, 0x1c / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform2f(this.uCam, camX, camY);
    gl.uniform1f(this.uScale, scale);
    gl.uniform1f(this.uSnap, snap);
    gl.uniform2f(this.uViewport, bufW, bufH);
    gl.uniform2f(this.uFloorOffset, 0, 0);
  }

  setFloorOffset(x: number, y: number) {
    this.gl.uniform2f(this.uFloorOffset, x, y);
  }

  dimViewport(alpha: number) {
    const gl = this.gl;
    gl.useProgram(this.dimProgram);
    gl.bindVertexArray(this.dimVao);
    gl.uniform4f(this.uDimColor, 0, 0, 0, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
  }

  drawChunkMesh(key: string) {
    const mesh = this.meshes.get(key);
    if (!mesh || mesh.count === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INSTANCE_STRIDE, 0);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, INSTANCE_STRIDE, 8);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, INSTANCE_STRIDE, 16);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, INSTANCE_STRIDE, 20);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, INSTANCE_STRIDE, 24);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, mesh.count);
  }

  drawGhost(data: Float32Array, camX: number, camY: number, scale: number, alpha: number) {
    if (data.length === 0) return;
    const gl = this.gl;
    gl.useProgram(this.ghostProgram);
    gl.bindVertexArray(this.hlVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform2f(this.ghostCam, camX, camY);
    gl.uniform1f(this.ghostScale, scale);
    gl.uniform1f(this.ghostSnap, 1);
    gl.uniform2f(this.ghostViewport, this.bufW, this.bufH);
    gl.uniform2f(this.ghostFloorOffset, 0, 0);
    gl.uniform1f(this.ghostAlpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hlBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.length / FLOATS_PER_INSTANCE);
  }

  endFrame() {
    this.gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const mesh of this.meshes.values()) gl.deleteBuffer(mesh.buffer);
    this.meshes.clear();
    gl.deleteTexture(this.atlas);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.hlBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.dimVao);
    gl.deleteVertexArray(this.hlVao);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.dimProgram);
    gl.deleteProgram(this.ghostProgram);
  }
}
