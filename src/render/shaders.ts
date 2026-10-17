/**
 * GLSL ES 3.00 shaders.
 * The 3D simplex noise is adapted from Ashima Arts / Stefan Gustavson (MIT licence).
 */

export const HEADER = `#version 300 es
precision highp float;
`;

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5, s=0.0;
  for(int i=0;i<OCTAVES;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
  return s;
}
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=hash21(p); return vec2(n, hash21(p+n*17.13)); }
`;

// ---------------------------------------------------------------------------
// Body (membrane, cytoplasm, nucleus, marks)
// ---------------------------------------------------------------------------

export const BODY_VS = HEADER + /* glsl */ `
layout(location=0) in vec2 aPos;
uniform vec2 uCenter;
uniform float uExtent;
uniform vec2 uView;
out vec2 vWorld;
void main(){
  vWorld = uCenter + aPos * uExtent;
  gl_Position = vec4(vWorld / uView, 0.0, 1.0);
}`;

export const BODY_FS = (octaves: number) => HEADER + `#define OCTAVES ${octaves}\n` + NOISE + /* glsl */ `
in vec2 vWorld;
out vec4 outColor;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uAmp[8];
uniform float uPhase[8];
uniform vec3 uPoly;     // sides, phase, strength
uniform vec2 uDent;     // angle, strength
uniform float uTime, uSpin, uBeat, uBeatPhase, uEnergy, uTension, uOpen, uCrystal, uSoft;
uniform float uRings, uEmber, uVacuoles, uHalo, uBright, uLightAngle, uDay, uGlow;
uniform vec2 uNucleus;
uniform vec3 uColA, uColB, uColC, uColE;
uniform vec4 uRipples[12];

const float TAU = 6.28318530718;

float shapeFactor(float th){
  float r = 1.0;
  for(int k=0;k<8;k++) r += uAmp[k] * cos(float(k+1)*th - uPhase[k]);
  if(uPoly.z > 0.0){
    float seg = TAU / uPoly.x;
    float a = mod(th - uPoly.y, seg);
    float poly = cos(3.14159265/uPoly.x) / cos(a - seg*0.5);
    r *= 1.0 + (poly - 1.0) * uPoly.z;
  }
  return r;
}

float angDelta(float a, float b){ float d = mod(b - a + 3.14159265, TAU) - 3.14159265; return d; }

vec2 rot(vec2 p, float a){ float c=cos(a), s=sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

void main(){
  vec2 q = vWorld - uCenter;
  // Ripples refract the membrane as their wavefront passes.
  for(int i=0;i<12;i++){
    vec4 rp = uRipples[i];
    if(rp.w <= 0.0) continue;
    vec2 dv = vWorld - rp.xy;
    float d = length(dv) + 1e-4;
    float front = rp.z * 0.9;
    float w = exp(-(d-front)*(d-front)/0.003) * rp.w * exp(-rp.z*1.1);
    q += dv / d * w * 0.018 * sin((d - front) * 70.0);
  }
  float th = atan(q.y, q.x);
  float R = uRadius * shapeFactor(th);
  float dd = angDelta(th, uDent.x);
  R -= uRadius * uDent.y * exp(-dd*dd/0.18);
  R = max(uRadius*0.35, R);
  float wob = snoise(vec3(cos(th)*1.7, sin(th)*1.7, uTime*0.25)) * 0.018 * (1.0 - uCrystal*0.7) * uRadius;
  R += wob;
  float r = length(q);
  float d = r / R;

  // Pseudo-3D volume: treat the disc as a lens-shaped sphere.
  vec2 pn = q / R;
  float z = sqrt(max(0.0, 1.0 - min(1.0, d*d)));
  vec3 N = normalize(vec3(pn, z + 1e-3));
  vec3 L = normalize(vec3(cos(uLightAngle), sin(uLightAngle), 0.9));
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), vec3(0.0,0.0,1.0)), 0.0), 18.0);
  float fres = pow(1.0 - z, 2.5);

  float inside = 1.0 - smoothstep(0.97 - uSoft*0.05, 1.0, d);
  float rimW = 0.022 + uSoft * 0.035 + uTension * 0.01;
  float rim = exp(-pow((d - 1.0) / rimW, 2.0));
  float outer = max(0.0, d - 1.0);
  float halo = exp(-outer * mix(10.0, 4.5, uSoft)) * step(1.0, d);
  // Calm halo (long stillness): a quiet second ring outside the body.
  float calm = exp(-pow((d - 1.45) / 0.05, 2.0)) * uHalo * 0.5;
  // Rim is lit unevenly: brighter on the side facing the light, dim on the far side.
  vec2 rimDir = normalize(pn + 1e-4);
  float sunSide = 0.35 + 0.95 * max(0.0, dot(rimDir, normalize(L.xy + 1e-4)));

  vec3 col = vec3(0.0);
  col += uColA * rim * (0.42 + fres * 0.4 + uBeat * 0.25) * sunSide;
  col += uColA * halo * 0.22 * uGlow;
  col += uColC * calm;

  // Everything below exists only inside the membrane. Most of this quad lies outside it,
  // so skipping the interior there saves the bulk of the shader's cost.
  if (d < 1.0) {
    // Interior sampled through a slight lens bulge, rotating with the body.
    vec2 ip = rot(pn * (0.75 + 0.25*z), -uSpin);
    float t = uTime;
    vec3 wp = vec3(ip * 1.8, t * 0.07);
    vec2 warp = vec2(fbm(wp + vec3(0.0,0.0,1.3)), fbm(wp + vec3(5.2,1.3,0.0)));
    float flow = fbm(vec3(ip * 2.4 + warp * (0.9 + uOpen*0.6), t * 0.11));

    // Cellular organelles: soft cells when warm, hard facets when crystalline.
    vec2 cp = ip * (3.2 + uCrystal * 2.0) + warp * 0.4;
    vec2 ci = floor(cp), cf = fract(cp);
    float f1 = 8.0, f2 = 8.0;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(ci + g);
      o = 0.5 + 0.42 * sin(t * 0.35 + TAU * o);
      vec2 dv = g + o - cf;
      float dist = mix(length(dv), max(abs(dv.x), abs(dv.y)) * 1.05, uCrystal * 0.8);
      if(dist < f1){ f2 = f1; f1 = dist; } else if(dist < f2){ f2 = dist; }
    }
    float edge = f2 - f1;
    float walls = 1.0 - smoothstep(0.0, mix(0.16, 0.05, uCrystal), edge);

    // Veins: thin ridges of noise.
    float vn = snoise(vec3(ip * 3.0 + warp, t * 0.05 + 4.0));
    float veins = 1.0 - smoothstep(0.0, 0.07, abs(vn));

    // Nucleus: heavy, lagging core with a heartbeat.
    vec2 np = ip - rot(uNucleus / max(uRadius, 1e-3), -uSpin) * 0.6;
    float nd = length(np);
    float nucleus = exp(-nd*nd*(22.0 - uBeat*6.0)) * (0.5 + uBeat * 0.8);
    float nucleusCore = exp(-nd*nd*160.0) * (0.5 + uBeat * 0.8);
    // Growth rings (storms survived): concentric luminous bands.
    float rings = 0.0;
    for(int i=0;i<9;i++){
      float fi = float(i);
      float vis = clamp(uRings - fi, 0.0, 1.0);
      if(vis <= 0.0) break;
      float rr = 0.86 - fi * 0.075 + sin(th * 3.0 + fi) * 0.008;
      rings += exp(-pow((d - rr) / 0.010, 2.0)) * vis * 0.55;
    }
    // Vacuoles (deluges): bright bubbles drifting in the cytoplasm.
    float vac = 0.0;
    for(int i=0;i<12;i++){
      float fi = float(i);
      if(fi >= uVacuoles) break;
      vec2 h = hash22(vec2(fi, 3.7));
      float a = h.x * TAU + t * 0.05 * (h.y - 0.5);
      vec2 c = vec2(cos(a), sin(a)) * (0.25 + h.y * 0.45);
      float s = 0.06 + h.x * 0.05;
      float dv = length(ip - c);
      vac += (exp(-pow((dv - s) / 0.012, 2.0)) * 0.9 + exp(-dv*dv/(s*s)) * 0.15) * clamp(uVacuoles - fi, 0.0, 1.0);
    }
    // Endoplasm: an inner, slower membrane that breathes against the outer one.
    float innerR = 0.62 + 0.05 * sin(th * 3.0 + t * 0.4) + 0.03 * snoise(vec3(cos(th), sin(th), t * 0.15)) - uBeat * 0.05;
    // A soft volume rather than a drawn line: brightest just inside its edge, fading inward.
    float endoEdge = smoothstep(innerR + 0.06, innerR - 0.02, d) * smoothstep(innerR - 0.30, innerR - 0.02, d);
    float endo = endoEdge * (0.16 + uOpen * 0.12) * (0.75 + 0.2 * snoise(vec3(ip * 4.0, t * 0.2)));
    float endoFill = smoothstep(innerR + 0.05, innerR - 0.18, d);

    // Heartbeat: a pressure wave travels from the nucleus out to the rim.
    float waveR = uBeatPhase * 1.25;
    float beatWave = exp(-pow((d - waveR) / 0.07, 2.0)) * (1.0 - smoothstep(0.55, 1.0, uBeatPhase)) * (0.35 + uEnergy * 0.4);
    float f01 = flow * 0.5 + 0.5;
    vec3 cyto = mix(uColB, uColA, f01);
    cyto = mix(cyto, uColC, smoothstep(0.55, 0.95, f01) * 0.5);
    float body = (0.10 + 0.30 * f01 * f01 + walls * (0.16 + uCrystal * 0.28) + veins * 0.14) * inside;
    // Outer cytoplasm is thin and glassy; the endoplasm is denser and warmer.
    body *= mix(0.55, 1.0, endoFill);
    col += cyto * body * (0.5 + diff * 0.7);
    col += mix(uColA, uColC, 0.35) * endo;
    col += mix(uColA, uColC, 0.5) * beatWave * inside;
    col += mix(uColC, uColE, uEmber) * nucleus * 0.85;
    col += vec3(1.0, 0.97, 0.92) * nucleusCore * 0.45;
    col += uColC * (rings + vac * 0.7) * inside;
    col += vec3(1.0) * spec * 0.35 * inside * (0.4 + uDay * 0.6);
  }
  col *= uBright;
  outColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// Filaments
// ---------------------------------------------------------------------------

export const FIL_VS = HEADER + /* glsl */ `
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aData; // side, along, intensity, hue
uniform vec2 uView;
out vec4 vData;
void main(){
  vData = aData;
  gl_Position = vec4(aPos / uView, 0.0, 1.0);
}`;

export const FIL_FS = HEADER + /* glsl */ `
in vec4 vData;
out vec4 outColor;
uniform vec3 uColA, uColC;
uniform float uBright;
void main(){
  float side = vData.x;
  float glow = exp(-side*side*3.5);
  float core = exp(-side*side*28.0);
  vec3 c = mix(uColA, uColC, vData.w);
  vec3 col = c * (glow * 0.45 + core * 0.9) * vData.z + vec3(1.0,0.97,0.94) * core * max(0.0, vData.z - 1.2) * 0.25;
  outColor = vec4(col * uBright, 1.0);
}`;

// ---------------------------------------------------------------------------
// Particles (instanced quads)
// ---------------------------------------------------------------------------

export const PART_VS = HEADER + /* glsl */ `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x, y, vx, vy
layout(location=2) in vec4 iB; // size, alpha, hue, kind
uniform vec2 uView;
uniform float uPixel; // world units per pixel
out vec2 vUV;
out vec4 vB;
void main(){
  vB = iB;
  vUV = aCorner;
  vec2 v = iA.zw;
  float sp = length(v);
  vec2 dir = sp > 1e-4 ? v / sp : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float kind = iB.w;
  float size = iB.x * uPixel * 3.0;
  vec2 offset;
  if(kind > 1.5 && kind < 2.5){
    // Raindrop streak aligned with its velocity.
    offset = dir * aCorner.y * (0.035 + sp * 0.012) + nrm * aCorner.x * uPixel * 1.2;
  } else {
    float stretch = 1.0 + min(sp * 2.0, 3.0) * step(2.5, kind);
    offset = dir * aCorner.y * size * stretch + nrm * aCorner.x * size;
  }
  gl_Position = vec4((iA.xy + offset) / uView, 0.0, 1.0);
}`;

export const PART_FS = HEADER + /* glsl */ `
in vec2 vUV;
in vec4 vB;
out vec4 outColor;
uniform vec3 uColA, uColC, uMote;
uniform float uBright;
void main(){
  float kind = vB.w;
  float r2 = dot(vUV, vUV);
  float a;
  vec3 c;
  if(kind > 1.5 && kind < 2.5){
    a = exp(-vUV.x*vUV.x*3.0) * (1.0 - abs(vUV.y)) ;
    c = vec3(0.62, 0.74, 0.86);
  } else {
    a = exp(-r2 * 4.0);
    if(kind < 0.5) c = uMote;
    else if(kind < 1.5) c = mix(uColA, uColC, vB.z);
    else c = mix(uColC, vec3(1.0), 0.4);
  }
  outColor = vec4(c * a * vB.y * uBright, 1.0);
}`;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

export const QUAD_VS = HEADER + /* glsl */ `
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FADE_FS = HEADER + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uDecay;
void main(){ outColor = texture(uTex, vUV) * uDecay; }`;

export const COPY_FS = HEADER + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uGain;
void main(){ outColor = texture(uTex, vUV) * uGain; }`;

/** Dual-filter (Kawase) downsample. */
export const DOWN_FS = HEADER + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uPrefilter;
void main(){
  vec2 o = uTexel;
  vec4 s = texture(uTex, vUV) * 4.0;
  s += texture(uTex, vUV - o);
  s += texture(uTex, vUV + o);
  s += texture(uTex, vUV + vec2(o.x, -o.y));
  s += texture(uTex, vUV - vec2(o.x, -o.y));
  vec4 c = s / 8.0;
  if(uPrefilter > 0.5){
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(0.05, 0.6, l);
  }
  outColor = c;
}`;

/** Dual-filter (Kawase) upsample with tent weights. */
export const UP_FS = HEADER + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main(){
  vec2 o = uTexel;
  vec4 s = texture(uTex, vUV + vec2(-o.x * 2.0, 0.0));
  s += texture(uTex, vUV + vec2(-o.x, o.y)) * 2.0;
  s += texture(uTex, vUV + vec2(0.0, o.y * 2.0));
  s += texture(uTex, vUV + vec2(o.x, o.y)) * 2.0;
  s += texture(uTex, vUV + vec2(o.x * 2.0, 0.0));
  s += texture(uTex, vUV + vec2(o.x, -o.y)) * 2.0;
  s += texture(uTex, vUV + vec2(0.0, -o.y * 2.0));
  s += texture(uTex, vUV + vec2(-o.x, -o.y)) * 2.0;
  outColor = s / 12.0;
}`;

export const COMPOSITE_FS = (octaves: number) => HEADER + `#define OCTAVES ${octaves}\n` + NOISE + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAtmo;
uniform vec2 uView;
uniform vec2 uResolution;
uniform float uTime, uDay, uTwilight, uCloud, uHumidity, uRain, uFlash, uFrost, uWarmth, uBloomGain, uGrain, uStorm;
uniform vec2 uFog;          // accumulated wind drift of the fog
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uColA;
uniform vec4 uRipples[12];
uniform float uLab;

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }

void main(){
  vec2 w = (vUV * 2.0 - 1.0) * uView;
  // Ripple refraction of the whole scene.
  vec2 disp = vec2(0.0);
  for(int i=0;i<12;i++){
    vec4 rp = uRipples[i];
    if(rp.w <= 0.0) continue;
    vec2 dv = w - rp.xy;
    float d = length(dv) + 1e-4;
    float front = rp.z * 0.9;
    float k = exp(-(d-front)*(d-front)/0.006) * rp.w * exp(-rp.z*1.2);
    disp += dv / d * k * sin((d-front)*55.0) * 0.006;
  }
  vec2 suv = vUV + disp / uView * 0.5;

  // Sky and fog come from the low-resolution atmosphere pass.
  vec3 col = texture(uAtmo, vUV).rgb;
  // Stars on clear nights, twinkling.
  float clear = (1.0 - uDay) * (1.0 - uCloud) * (1.0 - uHumidity * 0.4);
  if(clear > 0.01){
    vec2 sp = w * 70.0;
    vec2 cell = floor(sp);
    vec2 h = hash22(cell);
    vec2 sd = fract(sp) - h;
    float star = smoothstep(0.06, 0.0, length(sd)) * step(0.93, h.x);
    star *= 0.6 + 0.4 * sin(uTime * (1.0 + h.y * 3.0) + h.x * 50.0);
    col += vec3(0.75, 0.82, 1.0) * star * clear * 0.6;
  }
  // The organism's light scatters through humid air.
  float od = length(w - uCenter);
  col += uColA * exp(-od / (uRadius * (2.2 + uHumidity * 3.5))) * (0.05 + uHumidity * 0.12);

  vec3 scene = texture(uScene, suv).rgb;
  vec3 bloom = texture(uBloom, suv).rgb;
  col += scene;
  col += bloom * uBloomGain * (0.8 + uHumidity * 0.45);
  col += vec3(0.55, 0.6, 0.75) * uFlash * (0.4 + 0.6 * vUV.y);

  col = aces(col * 1.05);
  // Vignette.
  vec2 vq = vUV - 0.5;
  col *= 1.0 - dot(vq, vq) * (0.9 + uLab * 0.3);
  // Laboratory: a faint warm cast so it is never mistaken for real weather.
  col = mix(col, col * vec3(1.06, 0.98, 0.88), uLab * 0.6);
  col = pow(col, vec3(1.0/1.08));
  // Film grain.
  float g = hash21(vUV * uResolution + fract(uTime) * 97.0) - 0.5;
  col += g * uGrain;
  outColor = vec4(col, 1.0);
}`;

/**
 * Atmosphere: sky gradient and wind-carried fog. Smooth and slow, so it is
 * rendered at a fraction of screen resolution and upscaled bilinearly.
 */
export const ATMO_FS = (octaves: number) => HEADER + `#define OCTAVES ${octaves}\n` + NOISE + /* glsl */ `
in vec2 vUV;
out vec4 outColor;
uniform vec2 uView;
uniform float uTime, uDay, uTwilight, uCloud, uHumidity, uFrost;
uniform vec2 uFog;

vec3 sky(vec2 w, vec2 uv){
  float h = uv.y;
  vec3 nightTop = vec3(0.012, 0.016, 0.050);
  vec3 nightLow = vec3(0.030, 0.022, 0.070);
  vec3 dayTop   = vec3(0.030, 0.110, 0.160);
  vec3 dayLow   = vec3(0.080, 0.190, 0.220);
  vec3 duskTop  = vec3(0.070, 0.040, 0.130);
  vec3 duskLow  = vec3(0.300, 0.110, 0.150);
  vec3 top = mix(nightTop, dayTop, uDay);
  vec3 low = mix(nightLow, dayLow, uDay);
  top = mix(top, duskTop, uTwilight * 0.8);
  low = mix(low, duskLow, uTwilight);
  vec3 c = mix(low, top, smoothstep(0.0, 1.0, h));
  // Overcast: flatten and grey the sky.
  vec3 grey = vec3(0.07, 0.08, 0.095) * (0.5 + uDay * 0.9);
  c = mix(c, grey * mix(0.9, 1.1, h), uCloud * 0.6);
  // Frost cools the air.
  c = mix(c, c * vec3(0.8, 0.95, 1.15), uFrost * 0.5);
  return c;
}

void main(){
  vec2 w = (vUV * 2.0 - 1.0) * uView;
  vec3 col = sky(w, vUV);
  // Drifting fog layers; humidity thickens them, wind carries them.
  float fogA = fbm(vec3(w * 0.55 + uFog, uTime * 0.02));
  float fogB = fbm(vec3(w * 1.3 + uFog * 1.7 + 7.0, uTime * 0.03));
  float fog = smoothstep(-0.3, 0.8, fogA * 0.7 + fogB * 0.3);
  vec3 fogCol = mix(vec3(0.05, 0.07, 0.11), vec3(0.18, 0.24, 0.27), uDay);
  fogCol = mix(fogCol, vec3(0.30, 0.17, 0.20), uTwilight * 0.4);
  col += fogCol * fog * (0.12 + uHumidity * 0.35 + uCloud * 0.12);
  outColor = vec4(col, 1.0);
}`;
