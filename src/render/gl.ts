/** Thin WebGL2 helpers: programs, render targets and a fullscreen triangle. */

export class GLProgram {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string, label: string) {
    const v = compile(gl, gl.VERTEX_SHADER, vs, label);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, label);
    const p = gl.createProgram();
    if (!p) throw new Error('Could not create program');
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Link failed (${label}): ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.program = p;
  }

  use() {
    this.gl.useProgram(this.program);
  }

  u(name: string): WebGLUniformLocation | null {
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return loc;
  }

  attrib(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('Could not create shader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed (${label}): ${log}`);
  }
  return s;
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, hdr: boolean): RenderTarget {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`Framebuffer incomplete (${status})`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: RenderTarget | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** HSL (all 0..1) to linear-ish RGB triplet written into `out` at `o`. */
export function hsl(h: number, s: number, l: number, out: Float32Array, o = 0) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  out[o] = f(0);
  out[o + 1] = f(8);
  out[o + 2] = f(4);
}
