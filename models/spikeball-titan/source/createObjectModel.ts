import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Spikeball Titan Roundnet
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createSpikeballTitanRoundnetModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Spikeball Titan Roundnet";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 28.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": -0.5, "roll": 0.0}, "positionHint": [0.0, 1.15, 1.75], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review.", "poseFit": {"az": 10, "el": 24, "roll": -18, "dist": 3.065, "ox": -14, "oy": -34.6, "method": "silhouette IoU search vs hole-filled reference"}}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["rim-yellow"] = createSculptMaterial(
    "rim-yellow",
    {"id": "rim-yellow", "name": "Yellow rim band (polymer wrap)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F0C000", "color": "#F0C000", "albedo": {"dominant": "#F9DA09", "secondary": ["#32230D", "#D5B933", "#F1DB6A"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "models/spikeball-titan/pbr/rim-yellow_albedo.png", "url": "models/spikeball-titan/pbr/rim-yellow_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}}, "colorVariation": {"palette": ["#F9DA09", "#32230D", "#D5B933", "#F1DB6A", "#886F21"], "pattern": "reference-derived pixel palette", "amplitude": 0.32, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.62, "variation": 0.154, "map": {"path": "models/spikeball-titan/pbr/rim-yellow_roughness.png", "url": "models/spikeball-titan/pbr/rim-yellow_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.247, "map": {"path": "models/spikeball-titan/pbr/rim-yellow_normal.png", "url": "models/spikeball-titan/pbr/rim-yellow_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "heightSource": {"path": "models/spikeball-titan/pbr/rim-yellow_height.png", "url": "models/spikeball-titan/pbr/rim-yellow_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.035, "map": {"path": "models/spikeball-titan/pbr/rim-yellow_height.png", "url": "models/spikeball-titan/pbr/rim-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "models/spikeball-titan/pbr/rim-yellow_ao.png", "url": "models/spikeball-titan/pbr/rim-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "rim-edge-sheen", "region": "rim top edge", "roughness": 0.4, "note": "lower roughness on top bead"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "vivid yellow, satin", "referencePbr": {"version": "1.0", "sourceImage": "crops/rim-yellow.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "models/spikeball-titan/pbr/rim-yellow_albedo.png", "url": "models/spikeball-titan/pbr/rim-yellow_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}, "roughness": {"path": "models/spikeball-titan/pbr/rim-yellow_roughness.png", "url": "models/spikeball-titan/pbr/rim-yellow_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "height": {"path": "models/spikeball-titan/pbr/rim-yellow_height.png", "url": "models/spikeball-titan/pbr/rim-yellow_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "normal": {"path": "models/spikeball-titan/pbr/rim-yellow_normal.png", "url": "models/spikeball-titan/pbr/rim-yellow_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "ao": {"path": "models/spikeball-titan/pbr/rim-yellow_ao.png", "url": "models/spikeball-titan/pbr/rim-yellow_ao.png", "channel": "ao", "source": "procedural-seeded-grain (flat-paint colour)"}}, "diagnostics": {"sourceWidth": 540, "sourceHeight": 270, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 540, "height": 270}, "mask": {"backgroundColor": "#FEFEFE", "backgroundNoise": 254.608, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.7488}, "mapStats": {"valueRange": 0.762, "heightP90Gradient": 0.07774, "roughnessBase": 0.702, "roughnessVariation": 0.154, "normalStrength": 0.247, "blurRadius": 21}, "palette": ["#F9DA09", "#32230D", "#D5B933", "#F1DB6A", "#886F21"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "flatPaintNote": "uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance"}, "finishClass": "gem-metal", "texturePalette": ["#B8AB69", "#B8A33A", "#C2AB34", "#EAD55F", "#EFE2A0"], "proceduralTexture": "gradient-smoke", "clearcoat": 0.0, "clearcoatRoughness": {"base": 0.06, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.3, "finishOverrideNote": "Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review.", "doubleSided": true, "specularIntensity": 0.12},
    options
  );
  materialMap["net-black"] = createSculptMaterial(
    "net-black",
    {"id": "net-black", "name": "Black nylon net cord", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#111111", "color": "#111111", "albedo": {"dominant": "#FAF9FA", "secondary": ["#ECEBEC", "#3A393A", "#828182"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "models/spikeball-titan/pbr/net-black_albedo.png", "url": "models/spikeball-titan/pbr/net-black_albedo.png", "channel": "albedo", "source": "flat-paint-uniform"}}, "colorVariation": {"palette": ["#FAF9FA", "#ECEBEC", "#3A393A", "#828182", "#C0BFBF"], "pattern": "reference-derived pixel palette", "amplitude": 0.349, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.85, "variation": 0.214, "map": {"path": "models/spikeball-titan/pbr/net-black_roughness.png", "url": "models/spikeball-titan/pbr/net-black_roughness.png", "channel": "roughness", "source": "flat-paint-uniform"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.304, "map": {"path": "models/spikeball-titan/pbr/net-black_normal.png", "url": "models/spikeball-titan/pbr/net-black_normal.png", "channel": "normal", "source": "flat-paint-uniform"}, "heightSource": {"path": "models/spikeball-titan/pbr/net-black_height.png", "url": "models/spikeball-titan/pbr/net-black_height.png", "channel": "height", "source": "flat-paint-uniform"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.057, "map": {"path": "models/spikeball-titan/pbr/net-black_height.png", "url": "models/spikeball-titan/pbr/net-black_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "models/spikeball-titan/pbr/net-black_ao.png", "url": "models/spikeball-titan/pbr/net-black_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "knot-darkening", "region": "cord crossings", "roughness": 0.9, "note": "knots read darker/rougher"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "matte cord", "referencePbr": {"version": "1.0", "sourceImage": "crops/net-black.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.794, "estimatedFidelity": 0.794, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "models/spikeball-titan/pbr/net-black_albedo.png", "url": "models/spikeball-titan/pbr/net-black_albedo.png", "channel": "albedo", "source": "flat-paint-uniform"}, "roughness": {"path": "models/spikeball-titan/pbr/net-black_roughness.png", "url": "models/spikeball-titan/pbr/net-black_roughness.png", "channel": "roughness", "source": "flat-paint-uniform"}, "height": {"path": "models/spikeball-titan/pbr/net-black_height.png", "url": "models/spikeball-titan/pbr/net-black_height.png", "channel": "height", "source": "flat-paint-uniform"}, "normal": {"path": "models/spikeball-titan/pbr/net-black_normal.png", "url": "models/spikeball-titan/pbr/net-black_normal.png", "channel": "normal", "source": "flat-paint-uniform"}, "ao": {"path": "models/spikeball-titan/pbr/net-black_ao.png", "url": "models/spikeball-titan/pbr/net-black_ao.png", "channel": "ao", "source": "flat-paint-uniform"}}, "diagnostics": {"sourceWidth": 540, "sourceHeight": 330, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 540, "height": 330}, "mask": {"backgroundColor": "#A2A2AB", "backgroundNoise": 150.273, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.8314, "heightP90Gradient": 0.12643, "roughnessBase": 0.756, "roughnessVariation": 0.214, "normalStrength": 0.304, "blurRadius": 21}, "palette": ["#FAF9FA", "#ECEBEC", "#3A393A", "#828182", "#C0BFBF"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "flatPaintNote": "uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance"}, "finishClass": "brushed-steel", "texturePalette": ["#858587", "#C4C3C4", "#C6C6C6", "#C5C4C4", "#C5C4C4"], "proceduralTexture": "brushed", "clearcoat": 0.0, "clearcoatRoughness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "finishOverrideNote": "Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review.", "doubleSided": true, "specularIntensity": 0.12, "anisotropy": {"base": 1.0}},
    options
  );
  materialMap["net-sheet"] = createSculptMaterial(
    "net-sheet",
    {"id": "net-sheet", "name": "Net sheet (open mesh, mostly see-through)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#111111", "color": "#111111", "albedo": {"dominant": "#FAF9FA", "secondary": ["#ECEBEC", "#3A393A", "#828182"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "models/spikeball-titan/pbr/net-sheet_albedo.png", "url": "models/spikeball-titan/pbr/net-sheet_albedo.png", "channel": "albedo", "source": "flat-paint-uniform"}}, "colorVariation": {"palette": ["#FAF9FA", "#ECEBEC", "#3A393A", "#828182", "#C0BFBF"], "pattern": "reference-derived pixel palette", "amplitude": 0.349, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.9, "variation": 0.214, "map": {"path": "models/spikeball-titan/pbr/net-sheet_roughness.png", "url": "models/spikeball-titan/pbr/net-sheet_roughness.png", "channel": "roughness", "source": "flat-paint-uniform"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.304, "map": {"path": "models/spikeball-titan/pbr/net-sheet_normal.png", "url": "models/spikeball-titan/pbr/net-sheet_normal.png", "channel": "normal", "source": "flat-paint-uniform"}, "heightSource": {"path": "models/spikeball-titan/pbr/net-sheet_height.png", "url": "models/spikeball-titan/pbr/net-sheet_height.png", "channel": "height", "source": "flat-paint-uniform"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.057, "map": {"path": "models/spikeball-titan/pbr/net-sheet_height.png", "url": "models/spikeball-titan/pbr/net-sheet_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "models/spikeball-titan/pbr/net-sheet_ao.png", "url": "models/spikeball-titan/pbr/net-sheet_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "net-sheet-holes", "region": "net field", "roughness": 0.9, "note": "open holes dominate"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "net field between cords; opacity ~0.5 approximates the optical density of a fine black mesh seen at distance (open holes + cords)", "referencePbr": {"version": "1.0", "sourceImage": "crops/net-sheet.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.794, "estimatedFidelity": 0.794, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "models/spikeball-titan/pbr/net-sheet_albedo.png", "url": "models/spikeball-titan/pbr/net-sheet_albedo.png", "channel": "albedo", "source": "flat-paint-uniform"}, "roughness": {"path": "models/spikeball-titan/pbr/net-sheet_roughness.png", "url": "models/spikeball-titan/pbr/net-sheet_roughness.png", "channel": "roughness", "source": "flat-paint-uniform"}, "height": {"path": "models/spikeball-titan/pbr/net-sheet_height.png", "url": "models/spikeball-titan/pbr/net-sheet_height.png", "channel": "height", "source": "flat-paint-uniform"}, "normal": {"path": "models/spikeball-titan/pbr/net-sheet_normal.png", "url": "models/spikeball-titan/pbr/net-sheet_normal.png", "channel": "normal", "source": "flat-paint-uniform"}, "ao": {"path": "models/spikeball-titan/pbr/net-sheet_ao.png", "url": "models/spikeball-titan/pbr/net-sheet_ao.png", "channel": "ao", "source": "flat-paint-uniform"}}, "diagnostics": {"sourceWidth": 540, "sourceHeight": 330, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 540, "height": 330}, "mask": {"backgroundColor": "#A2A2AB", "backgroundNoise": 150.273, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.8314, "heightP90Gradient": 0.12643, "roughnessBase": 0.756, "roughnessVariation": 0.214, "normalStrength": 0.304, "blurRadius": 21}, "palette": ["#FAF9FA", "#ECEBEC", "#3A393A", "#828182", "#C0BFBF"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "flatPaintNote": "uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance"}, "finishClass": "brushed-steel", "texturePalette": ["#858587", "#C4C3C4", "#C6C6C6", "#C5C4C4", "#C5C4C4"], "proceduralTexture": "brushed", "clearcoat": 0.0, "clearcoatRoughness": {"base": 0.0, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "finishOverrideNote": "Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review.", "doubleSided": true, "specularIntensity": 0.12, "opacity": {"base": 0.2}, "anisotropy": {"base": 1.0}},
    options
  );
  materialMap["plastic-black"] = createSculptMaterial(
    "plastic-black",
    {"id": "plastic-black", "name": "Black injection-moulded plastic", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#161616", "color": "#161616", "albedo": {"dominant": "#202329", "secondary": ["#EFD110", "#292012", "#393E4B"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "models/spikeball-titan/pbr/plastic-black_albedo.png", "url": "models/spikeball-titan/pbr/plastic-black_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}}, "colorVariation": {"palette": ["#202329", "#EFD110", "#292012", "#393E4B", "#836A1A"], "pattern": "reference-derived pixel palette", "amplitude": 0.302, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.198, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.083, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.45, "variation": 0.05, "map": {"path": "models/spikeball-titan/pbr/plastic-black_roughness.png", "url": "models/spikeball-titan/pbr/plastic-black_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.17, "map": {"path": "models/spikeball-titan/pbr/plastic-black_normal.png", "url": "models/spikeball-titan/pbr/plastic-black_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "heightSource": {"path": "models/spikeball-titan/pbr/plastic-black_height.png", "url": "models/spikeball-titan/pbr/plastic-black_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.01, "map": {"path": "models/spikeball-titan/pbr/plastic-black_height.png", "url": "models/spikeball-titan/pbr/plastic-black_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "models/spikeball-titan/pbr/plastic-black_ao.png", "url": "models/spikeball-titan/pbr/plastic-black_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "foot-sheen", "region": "foot front face", "roughness": 0.35, "note": "glossier moulded faces"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "brackets and feet, slight sheen", "referencePbr": {"version": "1.0", "sourceImage": "crops/plastic-black.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.845, "estimatedFidelity": 0.845, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "models/spikeball-titan/pbr/plastic-black_albedo.png", "url": "models/spikeball-titan/pbr/plastic-black_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}, "roughness": {"path": "models/spikeball-titan/pbr/plastic-black_roughness.png", "url": "models/spikeball-titan/pbr/plastic-black_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "height": {"path": "models/spikeball-titan/pbr/plastic-black_height.png", "url": "models/spikeball-titan/pbr/plastic-black_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "normal": {"path": "models/spikeball-titan/pbr/plastic-black_normal.png", "url": "models/spikeball-titan/pbr/plastic-black_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "ao": {"path": "models/spikeball-titan/pbr/plastic-black_ao.png", "url": "models/spikeball-titan/pbr/plastic-black_ao.png", "channel": "ao", "source": "procedural-seeded-grain (flat-paint colour)"}}, "diagnostics": {"sourceWidth": 360, "sourceHeight": 120, "mapSize": 1024, "cropBBoxPixels": {"x": 52, "y": 0, "width": 308, "height": 120}, "mask": {"backgroundColor": "#FFFFFF", "backgroundNoise": 99.318, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.7961}, "mapStats": {"valueRange": 0.7202, "heightP90Gradient": 0.01153, "roughnessBase": 0.683, "roughnessVariation": 0.05, "normalStrength": 0.17, "blurRadius": 21}, "palette": ["#202329", "#EFD110", "#292012", "#393E4B", "#836A1A"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "flatPaintNote": "uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance"}, "finishClass": "painted-metal", "texturePalette": ["#EAEBEC", "#20252D", "#1F1E1E", "#9A8616", "#6C5F25"], "proceduralTexture": "flat-clearcoat", "clearcoat": 0.0, "clearcoatRoughness": {"base": 0.05, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "finishOverrideNote": "Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review.", "doubleSided": true, "specularIntensity": 0.5},
    options
  );
  materialMap["logo-yellow"] = createSculptMaterial(
    "logo-yellow",
    {"id": "logo-yellow", "name": "Yellow printed logo", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#F0C000", "color": "#F0C000", "albedo": {"dominant": "#F7DA08", "secondary": ["#231E15", "#A1881B", "#594214"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "models/spikeball-titan/pbr/logo-yellow_albedo.png", "url": "models/spikeball-titan/pbr/logo-yellow_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}}, "colorVariation": {"palette": ["#F7DA08", "#231E15", "#A1881B", "#594214", "#DBC028"], "pattern": "reference-derived pixel palette", "amplitude": 0.314, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.266, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.122, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.6, "variation": 0.055, "map": {"path": "models/spikeball-titan/pbr/logo-yellow_roughness.png", "url": "models/spikeball-titan/pbr/logo-yellow_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.189, "map": {"path": "models/spikeball-titan/pbr/logo-yellow_normal.png", "url": "models/spikeball-titan/pbr/logo-yellow_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "heightSource": {"path": "models/spikeball-titan/pbr/logo-yellow_height.png", "url": "models/spikeball-titan/pbr/logo-yellow_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.012, "map": {"path": "models/spikeball-titan/pbr/logo-yellow_height.png", "url": "models/spikeball-titan/pbr/logo-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "models/spikeball-titan/pbr/logo-yellow_ao.png", "url": "models/spikeball-titan/pbr/logo-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "decal-flat", "region": "logo faces", "roughness": 0.6, "note": "print sits flat on plastic"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "flat paint decal", "referencePbr": {"version": "1.0", "sourceImage": "crops/logo-yellow.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "models/spikeball-titan/pbr/logo-yellow_albedo.png", "url": "models/spikeball-titan/pbr/logo-yellow_albedo.png", "channel": "albedo", "source": "procedural-seeded-grain (flat-paint colour)"}, "roughness": {"path": "models/spikeball-titan/pbr/logo-yellow_roughness.png", "url": "models/spikeball-titan/pbr/logo-yellow_roughness.png", "channel": "roughness", "source": "procedural-seeded-grain (flat-paint colour)"}, "height": {"path": "models/spikeball-titan/pbr/logo-yellow_height.png", "url": "models/spikeball-titan/pbr/logo-yellow_height.png", "channel": "height", "source": "procedural-seeded-grain (flat-paint colour)"}, "normal": {"path": "models/spikeball-titan/pbr/logo-yellow_normal.png", "url": "models/spikeball-titan/pbr/logo-yellow_normal.png", "channel": "normal", "source": "procedural-seeded-grain (flat-paint colour)"}, "ao": {"path": "models/spikeball-titan/pbr/logo-yellow_ao.png", "url": "models/spikeball-titan/pbr/logo-yellow_ao.png", "channel": "ao", "source": "procedural-seeded-grain (flat-paint colour)"}}, "diagnostics": {"sourceWidth": 240, "sourceHeight": 150, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 240, "height": 150}, "mask": {"backgroundColor": "#23251B", "backgroundNoise": 24.515, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.8474}, "mapStats": {"valueRange": 0.7482, "heightP90Gradient": 0.02772, "roughnessBase": 0.692, "roughnessVariation": 0.055, "normalStrength": 0.189, "blurRadius": 21}, "palette": ["#F7DA08", "#231E15", "#A1881B", "#594214", "#DBC028"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "flatPaintNote": "uniform solid maps shipped for flat paint; raw extracted maps kept in pbr_extracted/ as provenance"}, "finishClass": "painted-metal", "texturePalette": ["#21211F", "#675B18", "#D9BD0A", "#827012", "#7A6912"], "proceduralTexture": "flat-clearcoat", "clearcoat": 0.0, "clearcoatRoughness": {"base": 0.05, "variation": 0.0}, "transmission": {"base": 0.0, "variation": 0.0}, "ior": {"base": 1.5, "value": 1.5}, "envMapIntensity": 1.0, "finishOverrideNote": "Classifier suggested metal; reference is polymer/nylon (dielectric) so metalness forced to 0 after visual review.", "doubleSided": true, "specularIntensity": 0.12},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Net disc__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.11, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Net disc", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat taut net disc: thin cylinder reads as the tensioned inner net surface.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.9, "height": 0.004, "depth": 0.9, "units": "meters", "confidence": 0.75}, "transform": {"position": [0, 0.11, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ball-contact", "localPosition": [0, 0.01, 0], "note": "centre-net hit point (effects/audio)"}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.9, 0.02, 0.9], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-sheet"}}, "material": "net-sheet", "materialLayers": ["net-sheet"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "flat", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "stand-in for the see-through mesh field"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(177, 176, 177, 1.0)", "secondaryAlbedo": "rgba(17, 17, 17, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7, "notes": "composite apparent colour of the see-through net field (cords + white gaps), mean of a 250x110 px reference patch = (177,176,177); cord colour is the secondary"}};
  node_root_0.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ball-contact", "localPosition": [0, 0.01, 0], "note": "centre-net hit point (effects/audio)"}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.9, 0.02, 0.9], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-sheet"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.9, 0.004, 0.9);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["net-sheet"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Net disc";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Net disc", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat taut net disc: thin cylinder reads as the tensioned inner net surface.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.9, "height": 0.004, "depth": 0.9, "units": "meters", "confidence": 0.75}, "transform": {"position": [0, 0.11, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ball-contact", "localPosition": [0, 0.01, 0], "note": "centre-net hit point (effects/audio)"}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.9, 0.02, 0.9], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-sheet"}}, "material": "net-sheet", "materialLayers": ["net-sheet"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "flat", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "stand-in for the see-through mesh field"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(177, 176, 177, 1.0)", "secondaryAlbedo": "rgba(17, 17, 17, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7, "notes": "composite apparent colour of the see-through net field (cords + white gaps), mean of a 250x110 px reference patch = (177,176,177); cord colour is the secondary"}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.9, 0.02, 0.9], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_root_0);
  const socket_root_ball_contact_0 = new THREE.Object3D();
  socket_root_ball_contact_0.name = "ball-contact";
  socket_root_ball_contact_0.position.set(0.0, 0.01, 0.0);
  socket_root_ball_contact_0.rotation.set(0, 0, 0);
  socket_root_ball_contact_0.userData.socket = {"id": "ball-contact", "localPosition": [0, 0.01, 0], "note": "centre-net hit point (effects/audio)"};
  node_root_0.add(socket_root_ball_contact_0);
  sockets["root:ball-contact"] = socket_root_ball_contact_0;

  const endpoint_rim_band_1 = makeAttachmentEndpoint(null);
  const node_rim_band_1 = new THREE.Group();
  node_rim_band_1.name = "Yellow rim band__pivot";
  node_rim_band_1.scale.set(1, 1, 1);
  if (endpoint_rim_band_1) {
    node_rim_band_1.position.copy(endpoint_rim_band_1.start);
    node_rim_band_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_band_1.position.set(0.0, 0.02, 0.0);
    node_rim_band_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_band_1.userData.sculptComponent = {"id": "rim-band", "name": "Yellow rim band", "level": "macro", "role": "ring", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Solid of revolution about the vertical axis (lathe) - radial symmetry, constant section.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.445, -0.06], [0.465, -0.06], [0.465, 0.06], [0.445, 0.06], [0.445, -0.06]], "segments": 96}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.02, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_band_1.userData.actionProfile = {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}};
  (nodes["root"] ?? root).add(node_rim_band_1);
  nodes["rim-band"] = node_rim_band_1;
  const mesh_rim_band_1Geometry = endpoint_rim_band_1
    ? new THREE.CylinderGeometry(endpoint_rim_band_1.endRadius, endpoint_rim_band_1.baseRadius, endpoint_rim_band_1.length, 16, 6)
    : buildLatheGeometry({"points": [[0.445, -0.06], [0.465, -0.06], [0.465, 0.06], [0.445, 0.06], [0.445, -0.06]], "segments": 96});
  if (!endpoint_rim_band_1) {
    mesh_rim_band_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_band_1 = new THREE.Mesh(
    mesh_rim_band_1Geometry,
    materialMap["rim-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_band_1.name = "Yellow rim band";
  if (endpoint_rim_band_1) {
    mesh_rim_band_1.position.copy(endpoint_rim_band_1.midpoint);
    mesh_rim_band_1.quaternion.copy(endpoint_rim_band_1.quaternion);
  }
  mesh_rim_band_1.castShadow = options.castShadow ?? true;
  mesh_rim_band_1.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_band_1.userData.sculptComponent = {"id": "rim-band", "name": "Yellow rim band", "level": "macro", "role": "ring", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Solid of revolution about the vertical axis (lathe) - radial symmetry, constant section.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.445, -0.06], [0.465, -0.06], [0.465, 0.06], [0.445, 0.06], [0.445, -0.06]], "segments": 96}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.8}, "transform": {"position": [0, 0.02, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_band_1.add(mesh_rim_band_1);
  meshes["rim-band"] = mesh_rim_band_1;
  colliders["rim-band"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"};
  destructionGroups["rim"] ??= [];
  destructionGroups["rim"].push(node_rim_band_1);

  const endpoint_rim_bead_top_2 = makeAttachmentEndpoint(null);
  const node_rim_bead_top_2 = new THREE.Group();
  node_rim_bead_top_2.name = "Rim top bead__pivot";
  node_rim_bead_top_2.scale.set(1, 1, 1);
  if (endpoint_rim_bead_top_2) {
    node_rim_bead_top_2.position.copy(endpoint_rim_bead_top_2.start);
    node_rim_bead_top_2.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_rim_bead_top_2.position.set(0.0, 0.08, 0.0);
    node_rim_bead_top_2.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_rim_bead_top_2.userData.sculptComponent = {"id": "rim-bead-top", "name": "Rim top bead", "level": "meso", "role": "ring", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Rolled lip following the rim circle: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.045}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_bead_top_2.userData.actionProfile = {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}};
  (nodes["root"] ?? root).add(node_rim_bead_top_2);
  nodes["rim-bead-top"] = node_rim_bead_top_2;
  const mesh_rim_bead_top_2Geometry = endpoint_rim_bead_top_2
    ? new THREE.CylinderGeometry(endpoint_rim_bead_top_2.endRadius, endpoint_rim_bead_top_2.baseRadius, endpoint_rim_bead_top_2.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0203, 12, 48);
  if (!endpoint_rim_bead_top_2) {
    mesh_rim_bead_top_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_bead_top_2 = new THREE.Mesh(
    mesh_rim_bead_top_2Geometry,
    materialMap["rim-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_bead_top_2.name = "Rim top bead";
  if (endpoint_rim_bead_top_2) {
    mesh_rim_bead_top_2.position.copy(endpoint_rim_bead_top_2.midpoint);
    mesh_rim_bead_top_2.quaternion.copy(endpoint_rim_bead_top_2.quaternion);
  }
  mesh_rim_bead_top_2.castShadow = options.castShadow ?? true;
  mesh_rim_bead_top_2.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_bead_top_2.userData.sculptComponent = {"id": "rim-bead-top", "name": "Rim top bead", "level": "meso", "role": "ring", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Rolled lip following the rim circle: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.045}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.08, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_bead_top_2.add(mesh_rim_bead_top_2);
  meshes["rim-bead-top"] = mesh_rim_bead_top_2;
  colliders["rim-bead-top"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"};
  destructionGroups["rim"] ??= [];
  destructionGroups["rim"].push(node_rim_bead_top_2);

  const endpoint_rim_bead_bottom_3 = makeAttachmentEndpoint(null);
  const node_rim_bead_bottom_3 = new THREE.Group();
  node_rim_bead_bottom_3.name = "Rim bottom bead__pivot";
  node_rim_bead_bottom_3.scale.set(1, 1, 1);
  if (endpoint_rim_bead_bottom_3) {
    node_rim_bead_bottom_3.position.copy(endpoint_rim_bead_bottom_3.start);
    node_rim_bead_bottom_3.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_rim_bead_bottom_3.position.set(0.0, -0.04, 0.0);
    node_rim_bead_bottom_3.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_rim_bead_bottom_3.userData.sculptComponent = {"id": "rim-bead-bottom", "name": "Rim bottom bead", "level": "meso", "role": "ring", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Rolled lip following the rim circle: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.045}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, -0.04, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_bead_bottom_3.userData.actionProfile = {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}};
  (nodes["root"] ?? root).add(node_rim_bead_bottom_3);
  nodes["rim-bead-bottom"] = node_rim_bead_bottom_3;
  const mesh_rim_bead_bottom_3Geometry = endpoint_rim_bead_bottom_3
    ? new THREE.CylinderGeometry(endpoint_rim_bead_bottom_3.endRadius, endpoint_rim_bead_bottom_3.baseRadius, endpoint_rim_bead_bottom_3.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0203, 12, 48);
  if (!endpoint_rim_bead_bottom_3) {
    mesh_rim_bead_bottom_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rim_bead_bottom_3 = new THREE.Mesh(
    mesh_rim_bead_bottom_3Geometry,
    materialMap["rim-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_bead_bottom_3.name = "Rim bottom bead";
  if (endpoint_rim_bead_bottom_3) {
    mesh_rim_bead_bottom_3.position.copy(endpoint_rim_bead_bottom_3.midpoint);
    mesh_rim_bead_bottom_3.quaternion.copy(endpoint_rim_bead_bottom_3.quaternion);
  }
  mesh_rim_bead_bottom_3.castShadow = options.castShadow ?? true;
  mesh_rim_bead_bottom_3.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_bead_bottom_3.userData.sculptComponent = {"id": "rim-bead-bottom", "name": "Rim bottom bead", "level": "meso", "role": "ring", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Rolled lip following the rim circle: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.045}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, -0.04, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "ring", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim", "seamRefs": ["rim-bead-top", "rim-bead-bottom"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rim-yellow"}}, "material": "rim-yellow", "materialLayers": ["rim-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.02, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none (rolled lip is real torus geometry)", "occlusionPattern": "soft AO in the bead/band crease", "edgeWearPattern": "none visible in photo", "notes": "satin polymer wrap; grain via independent normal+roughness maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(200, 160, 10, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_rim_bead_bottom_3.add(mesh_rim_bead_bottom_3);
  meshes["rim-bead-bottom"] = mesh_rim_bead_bottom_3;
  colliders["rim-bead-bottom"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [0.93, 0.13, 0.93], "isTrigger": false, "notes": "hollow ring: use 8 box proxies at runtime"};
  destructionGroups["rim"] ??= [];
  destructionGroups["rim"].push(node_rim_bead_bottom_3);

  const endpoint_net_ring_0_4 = makeAttachmentEndpoint(null);
  const node_net_ring_0_4 = new THREE.Group();
  node_net_ring_0_4.name = "Net concentric cord 0__pivot";
  node_net_ring_0_4.scale.set(1, 1, 1);
  if (endpoint_net_ring_0_4) {
    node_net_ring_0_4.position.copy(endpoint_net_ring_0_4.start);
    node_net_ring_0_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_0_4.position.set(0.0, 0.0, 0.0);
    node_net_ring_0_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_0_4.userData.sculptComponent = {"id": "net-ring-0", "name": "Net concentric cord 0", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.16, "height": 0.16, "depth": 0.16, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_0_4.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_0_4);
  nodes["net-ring-0"] = node_net_ring_0_4;
  const mesh_net_ring_0_4Geometry = endpoint_net_ring_0_4
    ? new THREE.CylinderGeometry(endpoint_net_ring_0_4.endRadius, endpoint_net_ring_0_4.baseRadius, endpoint_net_ring_0_4.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_0_4) {
    mesh_net_ring_0_4Geometry.scale(0.16, 0.16, 0.16);
  }
  const mesh_net_ring_0_4 = new THREE.Mesh(
    mesh_net_ring_0_4Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_0_4.name = "Net concentric cord 0";
  if (endpoint_net_ring_0_4) {
    mesh_net_ring_0_4.position.copy(endpoint_net_ring_0_4.midpoint);
    mesh_net_ring_0_4.quaternion.copy(endpoint_net_ring_0_4.quaternion);
  }
  mesh_net_ring_0_4.castShadow = options.castShadow ?? true;
  mesh_net_ring_0_4.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_0_4.userData.sculptComponent = {"id": "net-ring-0", "name": "Net concentric cord 0", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.16, "height": 0.16, "depth": 0.16, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_0_4.add(mesh_net_ring_0_4);
  meshes["net-ring-0"] = mesh_net_ring_0_4;
  colliders["net-ring-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_0_4);

  const endpoint_net_ring_1_5 = makeAttachmentEndpoint(null);
  const node_net_ring_1_5 = new THREE.Group();
  node_net_ring_1_5.name = "Net concentric cord 1__pivot";
  node_net_ring_1_5.scale.set(1, 1, 1);
  if (endpoint_net_ring_1_5) {
    node_net_ring_1_5.position.copy(endpoint_net_ring_1_5.start);
    node_net_ring_1_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_1_5.position.set(0.0, 0.0, 0.0);
    node_net_ring_1_5.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_1_5.userData.sculptComponent = {"id": "net-ring-1", "name": "Net concentric cord 1", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_1_5.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_1_5);
  nodes["net-ring-1"] = node_net_ring_1_5;
  const mesh_net_ring_1_5Geometry = endpoint_net_ring_1_5
    ? new THREE.CylinderGeometry(endpoint_net_ring_1_5.endRadius, endpoint_net_ring_1_5.baseRadius, endpoint_net_ring_1_5.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_1_5) {
    mesh_net_ring_1_5Geometry.scale(0.3, 0.3, 0.3);
  }
  const mesh_net_ring_1_5 = new THREE.Mesh(
    mesh_net_ring_1_5Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_1_5.name = "Net concentric cord 1";
  if (endpoint_net_ring_1_5) {
    mesh_net_ring_1_5.position.copy(endpoint_net_ring_1_5.midpoint);
    mesh_net_ring_1_5.quaternion.copy(endpoint_net_ring_1_5.quaternion);
  }
  mesh_net_ring_1_5.castShadow = options.castShadow ?? true;
  mesh_net_ring_1_5.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_1_5.userData.sculptComponent = {"id": "net-ring-1", "name": "Net concentric cord 1", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.3, "height": 0.3, "depth": 0.3, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_1_5.add(mesh_net_ring_1_5);
  meshes["net-ring-1"] = mesh_net_ring_1_5;
  colliders["net-ring-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_1_5);

  const endpoint_net_ring_2_6 = makeAttachmentEndpoint(null);
  const node_net_ring_2_6 = new THREE.Group();
  node_net_ring_2_6.name = "Net concentric cord 2__pivot";
  node_net_ring_2_6.scale.set(1, 1, 1);
  if (endpoint_net_ring_2_6) {
    node_net_ring_2_6.position.copy(endpoint_net_ring_2_6.start);
    node_net_ring_2_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_2_6.position.set(0.0, 0.0, 0.0);
    node_net_ring_2_6.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_2_6.userData.sculptComponent = {"id": "net-ring-2", "name": "Net concentric cord 2", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.44, "height": 0.44, "depth": 0.44, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_2_6.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_2_6);
  nodes["net-ring-2"] = node_net_ring_2_6;
  const mesh_net_ring_2_6Geometry = endpoint_net_ring_2_6
    ? new THREE.CylinderGeometry(endpoint_net_ring_2_6.endRadius, endpoint_net_ring_2_6.baseRadius, endpoint_net_ring_2_6.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_2_6) {
    mesh_net_ring_2_6Geometry.scale(0.44, 0.44, 0.44);
  }
  const mesh_net_ring_2_6 = new THREE.Mesh(
    mesh_net_ring_2_6Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_2_6.name = "Net concentric cord 2";
  if (endpoint_net_ring_2_6) {
    mesh_net_ring_2_6.position.copy(endpoint_net_ring_2_6.midpoint);
    mesh_net_ring_2_6.quaternion.copy(endpoint_net_ring_2_6.quaternion);
  }
  mesh_net_ring_2_6.castShadow = options.castShadow ?? true;
  mesh_net_ring_2_6.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_2_6.userData.sculptComponent = {"id": "net-ring-2", "name": "Net concentric cord 2", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.44, "height": 0.44, "depth": 0.44, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_2_6.add(mesh_net_ring_2_6);
  meshes["net-ring-2"] = mesh_net_ring_2_6;
  colliders["net-ring-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_2_6);

  const endpoint_net_ring_3_7 = makeAttachmentEndpoint(null);
  const node_net_ring_3_7 = new THREE.Group();
  node_net_ring_3_7.name = "Net concentric cord 3__pivot";
  node_net_ring_3_7.scale.set(1, 1, 1);
  if (endpoint_net_ring_3_7) {
    node_net_ring_3_7.position.copy(endpoint_net_ring_3_7.start);
    node_net_ring_3_7.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_3_7.position.set(0.0, 0.0, 0.0);
    node_net_ring_3_7.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_3_7.userData.sculptComponent = {"id": "net-ring-3", "name": "Net concentric cord 3", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.58, "depth": 0.58, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_3_7.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_3_7);
  nodes["net-ring-3"] = node_net_ring_3_7;
  const mesh_net_ring_3_7Geometry = endpoint_net_ring_3_7
    ? new THREE.CylinderGeometry(endpoint_net_ring_3_7.endRadius, endpoint_net_ring_3_7.baseRadius, endpoint_net_ring_3_7.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_3_7) {
    mesh_net_ring_3_7Geometry.scale(0.58, 0.58, 0.58);
  }
  const mesh_net_ring_3_7 = new THREE.Mesh(
    mesh_net_ring_3_7Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_3_7.name = "Net concentric cord 3";
  if (endpoint_net_ring_3_7) {
    mesh_net_ring_3_7.position.copy(endpoint_net_ring_3_7.midpoint);
    mesh_net_ring_3_7.quaternion.copy(endpoint_net_ring_3_7.quaternion);
  }
  mesh_net_ring_3_7.castShadow = options.castShadow ?? true;
  mesh_net_ring_3_7.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_3_7.userData.sculptComponent = {"id": "net-ring-3", "name": "Net concentric cord 3", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.58, "depth": 0.58, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_3_7.add(mesh_net_ring_3_7);
  meshes["net-ring-3"] = mesh_net_ring_3_7;
  colliders["net-ring-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_3_7);

  const endpoint_net_ring_4_8 = makeAttachmentEndpoint(null);
  const node_net_ring_4_8 = new THREE.Group();
  node_net_ring_4_8.name = "Net concentric cord 4__pivot";
  node_net_ring_4_8.scale.set(1, 1, 1);
  if (endpoint_net_ring_4_8) {
    node_net_ring_4_8.position.copy(endpoint_net_ring_4_8.start);
    node_net_ring_4_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_4_8.position.set(0.0, 0.0, 0.0);
    node_net_ring_4_8.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_4_8.userData.sculptComponent = {"id": "net-ring-4", "name": "Net concentric cord 4", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.72, "height": 0.72, "depth": 0.72, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_4_8.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_4_8);
  nodes["net-ring-4"] = node_net_ring_4_8;
  const mesh_net_ring_4_8Geometry = endpoint_net_ring_4_8
    ? new THREE.CylinderGeometry(endpoint_net_ring_4_8.endRadius, endpoint_net_ring_4_8.baseRadius, endpoint_net_ring_4_8.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_4_8) {
    mesh_net_ring_4_8Geometry.scale(0.72, 0.72, 0.72);
  }
  const mesh_net_ring_4_8 = new THREE.Mesh(
    mesh_net_ring_4_8Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_4_8.name = "Net concentric cord 4";
  if (endpoint_net_ring_4_8) {
    mesh_net_ring_4_8.position.copy(endpoint_net_ring_4_8.midpoint);
    mesh_net_ring_4_8.quaternion.copy(endpoint_net_ring_4_8.quaternion);
  }
  mesh_net_ring_4_8.castShadow = options.castShadow ?? true;
  mesh_net_ring_4_8.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_4_8.userData.sculptComponent = {"id": "net-ring-4", "name": "Net concentric cord 4", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.72, "height": 0.72, "depth": 0.72, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_4_8.add(mesh_net_ring_4_8);
  meshes["net-ring-4"] = mesh_net_ring_4_8;
  colliders["net-ring-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_4_8);

  const endpoint_net_ring_5_9 = makeAttachmentEndpoint(null);
  const node_net_ring_5_9 = new THREE.Group();
  node_net_ring_5_9.name = "Net concentric cord 5__pivot";
  node_net_ring_5_9.scale.set(1, 1, 1);
  if (endpoint_net_ring_5_9) {
    node_net_ring_5_9.position.copy(endpoint_net_ring_5_9.start);
    node_net_ring_5_9.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_ring_5_9.position.set(0.0, 0.0, 0.0);
    node_net_ring_5_9.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_ring_5_9.userData.sculptComponent = {"id": "net-ring-5", "name": "Net concentric cord 5", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.86, "height": 0.86, "depth": 0.86, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_5_9.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_ring_5_9);
  nodes["net-ring-5"] = node_net_ring_5_9;
  const mesh_net_ring_5_9Geometry = endpoint_net_ring_5_9
    ? new THREE.CylinderGeometry(endpoint_net_ring_5_9.endRadius, endpoint_net_ring_5_9.baseRadius, endpoint_net_ring_5_9.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0054, 12, 48);
  if (!endpoint_net_ring_5_9) {
    mesh_net_ring_5_9Geometry.scale(0.86, 0.86, 0.86);
  }
  const mesh_net_ring_5_9 = new THREE.Mesh(
    mesh_net_ring_5_9Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_ring_5_9.name = "Net concentric cord 5";
  if (endpoint_net_ring_5_9) {
    mesh_net_ring_5_9.position.copy(endpoint_net_ring_5_9.midpoint);
    mesh_net_ring_5_9.quaternion.copy(endpoint_net_ring_5_9.quaternion);
  }
  mesh_net_ring_5_9.castShadow = options.castShadow ?? true;
  mesh_net_ring_5_9.receiveShadow = options.receiveShadow ?? true;
  mesh_net_ring_5_9.userData.sculptComponent = {"id": "net-ring-5", "name": "Net concentric cord 5", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Concentric net cord as a thin torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.012}, "parent": "root", "attachment": null, "dimensions": {"width": 0.86, "height": 0.86, "depth": 0.86, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_ring_5_9.add(mesh_net_ring_5_9);
  meshes["net-ring-5"] = mesh_net_ring_5_9;
  colliders["net-ring-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_ring_5_9);

  const endpoint_net_edge_binding_10 = makeAttachmentEndpoint(null);
  const node_net_edge_binding_10 = new THREE.Group();
  node_net_edge_binding_10.name = "Net edge binding__pivot";
  node_net_edge_binding_10.scale.set(1, 1, 1);
  if (endpoint_net_edge_binding_10) {
    node_net_edge_binding_10.position.copy(endpoint_net_edge_binding_10.start);
    node_net_edge_binding_10.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_net_edge_binding_10.position.set(0.0, 0.004, 0.0);
    node_net_edge_binding_10.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_net_edge_binding_10.userData.sculptComponent = {"id": "net-edge-binding", "name": "Net edge binding", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Black binding where net meets rim top: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.02}, "parent": "root", "attachment": null, "dimensions": {"width": 0.97, "height": 0.97, "depth": 0.97, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.004, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "net-rim-wrap", "type": "fiber", "note": "coarse diamond mesh wrapped over the rim"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_edge_binding_10.userData.actionProfile = {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["root"] ?? root).add(node_net_edge_binding_10);
  nodes["net-edge-binding"] = node_net_edge_binding_10;
  const mesh_net_edge_binding_10Geometry = endpoint_net_edge_binding_10
    ? new THREE.CylinderGeometry(endpoint_net_edge_binding_10.endRadius, endpoint_net_edge_binding_10.baseRadius, endpoint_net_edge_binding_10.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.009, 12, 48);
  if (!endpoint_net_edge_binding_10) {
    mesh_net_edge_binding_10Geometry.scale(0.97, 0.97, 0.97);
  }
  const mesh_net_edge_binding_10 = new THREE.Mesh(
    mesh_net_edge_binding_10Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_net_edge_binding_10.name = "Net edge binding";
  if (endpoint_net_edge_binding_10) {
    mesh_net_edge_binding_10.position.copy(endpoint_net_edge_binding_10.midpoint);
    mesh_net_edge_binding_10.quaternion.copy(endpoint_net_edge_binding_10.quaternion);
  }
  mesh_net_edge_binding_10.castShadow = options.castShadow ?? true;
  mesh_net_edge_binding_10.receiveShadow = options.receiveShadow ?? true;
  mesh_net_edge_binding_10.userData.sculptComponent = {"id": "net-edge-binding", "name": "Net edge binding", "level": "meso", "role": "net", "importance": 1.0, "confidence": 0.7, "primitive": "torus", "topologyClass": "fiber-strand", "topologyRationale": "Black binding where net meets rim top: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.02}, "parent": "root", "attachment": null, "dimensions": {"width": 0.97, "height": 0.97, "depth": 0.97, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.004, 0], "rotation": [1.5707963267948966, 0, 0]}, "actionProfile": {"animationRole": "net", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "net", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "net-rim-wrap", "type": "fiber", "note": "coarse diamond mesh wrapped over the rim"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_net_edge_binding_10.add(mesh_net_edge_binding_10);
  meshes["net-edge-binding"] = mesh_net_edge_binding_10;
  colliders["net-edge-binding"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.05, 0.01, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["net"] ??= [];
  destructionGroups["net"].push(node_net_edge_binding_10);

  const endpoint_bracket_mount_11 = makeAttachmentEndpoint(null);
  const node_bracket_mount_11 = new THREE.Group();
  node_bracket_mount_11.name = "Bracket mount frame__pivot";
  node_bracket_mount_11.scale.set(1, 1, 1);
  if (endpoint_bracket_mount_11) {
    node_bracket_mount_11.position.copy(endpoint_bracket_mount_11.start);
    node_bracket_mount_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bracket_mount_11.position.set(0.0, 0.012, 0.0);
    node_bracket_mount_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_bracket_mount_11.userData.sculptComponent = {"id": "bracket-mount", "name": "Bracket mount frame", "level": "macro", "role": "mount", "importance": 1.0, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible-scale pivot carrying the 4 corner brackets.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.01, "height": 0.001, "depth": 0.01, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.012, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screw-heads", "type": "fastener", "note": "one screw/hole centred on each bracket"}], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_mount_11.userData.actionProfile = {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_bracket_mount_11);
  nodes["bracket-mount"] = node_bracket_mount_11;
  const mesh_bracket_mount_11Geometry = endpoint_bracket_mount_11
    ? new THREE.CylinderGeometry(endpoint_bracket_mount_11.endRadius, endpoint_bracket_mount_11.baseRadius, endpoint_bracket_mount_11.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bracket_mount_11) {
    mesh_bracket_mount_11Geometry.scale(0.01, 0.001, 0.01);
  }
  const mesh_bracket_mount_11 = new THREE.Mesh(
    mesh_bracket_mount_11Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_mount_11.name = "Bracket mount frame";
  if (endpoint_bracket_mount_11) {
    mesh_bracket_mount_11.position.copy(endpoint_bracket_mount_11.midpoint);
    mesh_bracket_mount_11.quaternion.copy(endpoint_bracket_mount_11.quaternion);
  }
  mesh_bracket_mount_11.castShadow = options.castShadow ?? true;
  mesh_bracket_mount_11.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_mount_11.userData.sculptComponent = {"id": "bracket-mount", "name": "Bracket mount frame", "level": "macro", "role": "mount", "importance": 1.0, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible-scale pivot carrying the 4 corner brackets.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.01, "height": 0.001, "depth": 0.01, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, 0.012, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "screw-heads", "type": "fastener", "note": "one screw/hole centred on each bracket"}], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_mount_11.add(mesh_bracket_mount_11);
  meshes["bracket-mount"] = mesh_bracket_mount_11;
  colliders["bracket-mount"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["mounts"] ??= [];
  destructionGroups["mounts"].push(node_bracket_mount_11);

  const endpoint_foot_mount_12 = makeAttachmentEndpoint(null);
  const node_foot_mount_12 = new THREE.Group();
  node_foot_mount_12.name = "Foot mount frame__pivot";
  node_foot_mount_12.scale.set(1, 1, 1);
  if (endpoint_foot_mount_12) {
    node_foot_mount_12.position.copy(endpoint_foot_mount_12.start);
    node_foot_mount_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_mount_12.position.set(0.0, -0.11, 0.0);
    node_foot_mount_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_mount_12.userData.sculptComponent = {"id": "foot-mount", "name": "Foot mount frame", "level": "macro", "role": "mount", "importance": 1.0, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible-scale pivot at ground level carrying the 4 feet.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.01, "height": 0.001, "depth": 0.01, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, -0.11, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_mount_12.userData.actionProfile = {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_foot_mount_12);
  nodes["foot-mount"] = node_foot_mount_12;
  const mesh_foot_mount_12Geometry = endpoint_foot_mount_12
    ? new THREE.CylinderGeometry(endpoint_foot_mount_12.endRadius, endpoint_foot_mount_12.baseRadius, endpoint_foot_mount_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_foot_mount_12) {
    mesh_foot_mount_12Geometry.scale(0.01, 0.001, 0.01);
  }
  const mesh_foot_mount_12 = new THREE.Mesh(
    mesh_foot_mount_12Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_mount_12.name = "Foot mount frame";
  if (endpoint_foot_mount_12) {
    mesh_foot_mount_12.position.copy(endpoint_foot_mount_12.midpoint);
    mesh_foot_mount_12.quaternion.copy(endpoint_foot_mount_12.quaternion);
  }
  mesh_foot_mount_12.castShadow = options.castShadow ?? true;
  mesh_foot_mount_12.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_mount_12.userData.sculptComponent = {"id": "foot-mount", "name": "Foot mount frame", "level": "macro", "role": "mount", "importance": 1.0, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible-scale pivot at ground level carrying the 4 feet.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.01, "height": 0.001, "depth": 0.01, "units": "meters", "confidence": 0.7}, "transform": {"position": [0, -0.11, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "mount", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "mounts", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_mount_12.add(mesh_foot_mount_12);
  meshes["foot-mount"] = mesh_foot_mount_12;
  colliders["foot-mount"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.01, 0.01, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["mounts"] ??= [];
  destructionGroups["mounts"].push(node_foot_mount_12);

  const endpoint_foot_e_13 = makeAttachmentEndpoint(null);
  const node_foot_e_13 = new THREE.Group();
  node_foot_e_13.name = "Wedge foot (e)__pivot";
  node_foot_e_13.scale.set(1, 1, 1);
  if (endpoint_foot_e_13) {
    node_foot_e_13.position.copy(endpoint_foot_e_13.start);
    node_foot_e_13.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_foot_e_13.position.set(0.395, 0.0, 0.0);
    node_foot_e_13.rotation.set(0.0, 1.5708, 0.0);
  }
  node_foot_e_13.userData.sculptComponent = {"id": "foot-e", "name": "Wedge foot (e)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.395, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_e_13.userData.actionProfile = {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["foot-mount"] ?? root).add(node_foot_e_13);
  nodes["foot-e"] = node_foot_e_13;
  const mesh_foot_e_13Geometry = endpoint_foot_e_13
    ? new THREE.CylinderGeometry(endpoint_foot_e_13.endRadius, endpoint_foot_e_13.baseRadius, endpoint_foot_e_13.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1});
  if (!endpoint_foot_e_13) {
    mesh_foot_e_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_foot_e_13 = new THREE.Mesh(
    mesh_foot_e_13Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_e_13.name = "Wedge foot (e)";
  if (endpoint_foot_e_13) {
    mesh_foot_e_13.position.copy(endpoint_foot_e_13.midpoint);
    mesh_foot_e_13.quaternion.copy(endpoint_foot_e_13.quaternion);
  }
  mesh_foot_e_13.castShadow = options.castShadow ?? true;
  mesh_foot_e_13.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_e_13.userData.sculptComponent = {"id": "foot-e", "name": "Wedge foot (e)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.395, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_e_13.add(mesh_foot_e_13);
  meshes["foot-e"] = mesh_foot_e_13;
  colliders["foot-e"] = {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["feet"] ??= [];
  destructionGroups["feet"].push(node_foot_e_13);
  const socket_foot_e_ground_contact_0 = new THREE.Object3D();
  socket_foot_e_ground_contact_0.name = "ground-contact";
  socket_foot_e_ground_contact_0.position.set(0.0, 0.0, 0.05);
  socket_foot_e_ground_contact_0.rotation.set(0, 0, 0);
  socket_foot_e_ground_contact_0.userData.socket = {"id": "ground-contact", "localPosition": [0, 0, 0.05]};
  node_foot_e_13.add(socket_foot_e_ground_contact_0);
  sockets["foot-e:ground-contact"] = socket_foot_e_ground_contact_0;

  const endpoint_bracket_wall_e_14 = makeAttachmentEndpoint(null);
  const node_bracket_wall_e_14 = new THREE.Group();
  node_bracket_wall_e_14.name = "Bracket wall plate (e)__pivot";
  node_bracket_wall_e_14.scale.set(1, 1, 1);
  if (endpoint_bracket_wall_e_14) {
    node_bracket_wall_e_14.position.copy(endpoint_bracket_wall_e_14.start);
    node_bracket_wall_e_14.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_bracket_wall_e_14.position.set(0.466, 0.0, 0.0);
    node_bracket_wall_e_14.rotation.set(0.0, 1.5708, 0.0);
  }
  node_bracket_wall_e_14.userData.sculptComponent = {"id": "bracket-wall-e", "name": "Bracket wall plate (e)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.466, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_e_14.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_wall_e_14);
  nodes["bracket-wall-e"] = node_bracket_wall_e_14;
  const mesh_bracket_wall_e_14Geometry = endpoint_bracket_wall_e_14
    ? new THREE.CylinderGeometry(endpoint_bracket_wall_e_14.endRadius, endpoint_bracket_wall_e_14.baseRadius, endpoint_bracket_wall_e_14.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_wall_e_14) {
    mesh_bracket_wall_e_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_wall_e_14 = new THREE.Mesh(
    mesh_bracket_wall_e_14Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_wall_e_14.name = "Bracket wall plate (e)";
  if (endpoint_bracket_wall_e_14) {
    mesh_bracket_wall_e_14.position.copy(endpoint_bracket_wall_e_14.midpoint);
    mesh_bracket_wall_e_14.quaternion.copy(endpoint_bracket_wall_e_14.quaternion);
  }
  mesh_bracket_wall_e_14.castShadow = options.castShadow ?? true;
  mesh_bracket_wall_e_14.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_wall_e_14.userData.sculptComponent = {"id": "bracket-wall-e", "name": "Bracket wall plate (e)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.466, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_e_14.add(mesh_bracket_wall_e_14);
  meshes["bracket-wall-e"] = mesh_bracket_wall_e_14;
  colliders["bracket-wall-e"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_wall_e_14);

  const endpoint_bracket_inner_e_15 = makeAttachmentEndpoint(null);
  const node_bracket_inner_e_15 = new THREE.Group();
  node_bracket_inner_e_15.name = "Bracket inner wall plate (e)__pivot";
  node_bracket_inner_e_15.scale.set(1, 1, 1);
  if (endpoint_bracket_inner_e_15) {
    node_bracket_inner_e_15.position.copy(endpoint_bracket_inner_e_15.start);
    node_bracket_inner_e_15.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_bracket_inner_e_15.position.set(0.432, 0.0, 0.0);
    node_bracket_inner_e_15.rotation.set(0.0, 1.5708, 0.0);
  }
  node_bracket_inner_e_15.userData.sculptComponent = {"id": "bracket-inner-e", "name": "Bracket inner wall plate (e)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [0.432, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_e_15.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_inner_e_15);
  nodes["bracket-inner-e"] = node_bracket_inner_e_15;
  const mesh_bracket_inner_e_15Geometry = endpoint_bracket_inner_e_15
    ? new THREE.CylinderGeometry(endpoint_bracket_inner_e_15.endRadius, endpoint_bracket_inner_e_15.baseRadius, endpoint_bracket_inner_e_15.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_inner_e_15) {
    mesh_bracket_inner_e_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_inner_e_15 = new THREE.Mesh(
    mesh_bracket_inner_e_15Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_inner_e_15.name = "Bracket inner wall plate (e)";
  if (endpoint_bracket_inner_e_15) {
    mesh_bracket_inner_e_15.position.copy(endpoint_bracket_inner_e_15.midpoint);
    mesh_bracket_inner_e_15.quaternion.copy(endpoint_bracket_inner_e_15.quaternion);
  }
  mesh_bracket_inner_e_15.castShadow = options.castShadow ?? true;
  mesh_bracket_inner_e_15.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_inner_e_15.userData.sculptComponent = {"id": "bracket-inner-e", "name": "Bracket inner wall plate (e)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [0.432, 0, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_e_15.add(mesh_bracket_inner_e_15);
  meshes["bracket-inner-e"] = mesh_bracket_inner_e_15;
  colliders["bracket-inner-e"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_inner_e_15);

  const endpoint_bracket_top_e_16 = makeAttachmentEndpoint(null);
  const node_bracket_top_e_16 = new THREE.Group();
  node_bracket_top_e_16.name = "Bracket top plate (e)__pivot";
  node_bracket_top_e_16.scale.set(1, 1, 1);
  if (endpoint_bracket_top_e_16) {
    node_bracket_top_e_16.position.copy(endpoint_bracket_top_e_16.start);
    node_bracket_top_e_16.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_bracket_top_e_16.position.set(0.395, -0.006, 0.0);
    node_bracket_top_e_16.rotation.set(0.0, 1.5708, 0.0);
  }
  node_bracket_top_e_16.userData.sculptComponent = {"id": "bracket-top-e", "name": "Bracket top plate (e)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.395, -0.006, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_e_16.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_top_e_16);
  nodes["bracket-top-e"] = node_bracket_top_e_16;
  const mesh_bracket_top_e_16Geometry = endpoint_bracket_top_e_16
    ? new THREE.CylinderGeometry(endpoint_bracket_top_e_16.endRadius, endpoint_bracket_top_e_16.baseRadius, endpoint_bracket_top_e_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bracket_top_e_16) {
    mesh_bracket_top_e_16Geometry.scale(0.15, 0.01, 0.11);
  }
  const mesh_bracket_top_e_16 = new THREE.Mesh(
    mesh_bracket_top_e_16Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_e_16.name = "Bracket top plate (e)";
  if (endpoint_bracket_top_e_16) {
    mesh_bracket_top_e_16.position.copy(endpoint_bracket_top_e_16.midpoint);
    mesh_bracket_top_e_16.quaternion.copy(endpoint_bracket_top_e_16.quaternion);
  }
  mesh_bracket_top_e_16.castShadow = options.castShadow ?? true;
  mesh_bracket_top_e_16.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_e_16.userData.sculptComponent = {"id": "bracket-top-e", "name": "Bracket top plate (e)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.395, -0.006, 0.0], "rotation": [0, 1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-e"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_e_16.add(mesh_bracket_top_e_16);
  meshes["bracket-top-e"] = mesh_bracket_top_e_16;
  colliders["bracket-top-e"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_top_e_16);

  const endpoint_foot_s_17 = makeAttachmentEndpoint(null);
  const node_foot_s_17 = new THREE.Group();
  node_foot_s_17.name = "Wedge foot (s)__pivot";
  node_foot_s_17.scale.set(1, 1, 1);
  if (endpoint_foot_s_17) {
    node_foot_s_17.position.copy(endpoint_foot_s_17.start);
    node_foot_s_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_s_17.position.set(0.0, 0.0, 0.395);
    node_foot_s_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_s_17.userData.sculptComponent = {"id": "foot-s", "name": "Wedge foot (s)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, 0, 0.395], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_s_17.userData.actionProfile = {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["foot-mount"] ?? root).add(node_foot_s_17);
  nodes["foot-s"] = node_foot_s_17;
  const mesh_foot_s_17Geometry = endpoint_foot_s_17
    ? new THREE.CylinderGeometry(endpoint_foot_s_17.endRadius, endpoint_foot_s_17.baseRadius, endpoint_foot_s_17.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1});
  if (!endpoint_foot_s_17) {
    mesh_foot_s_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_foot_s_17 = new THREE.Mesh(
    mesh_foot_s_17Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_s_17.name = "Wedge foot (s)";
  if (endpoint_foot_s_17) {
    mesh_foot_s_17.position.copy(endpoint_foot_s_17.midpoint);
    mesh_foot_s_17.quaternion.copy(endpoint_foot_s_17.quaternion);
  }
  mesh_foot_s_17.castShadow = options.castShadow ?? true;
  mesh_foot_s_17.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_s_17.userData.sculptComponent = {"id": "foot-s", "name": "Wedge foot (s)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, 0, 0.395], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_s_17.add(mesh_foot_s_17);
  meshes["foot-s"] = mesh_foot_s_17;
  colliders["foot-s"] = {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["feet"] ??= [];
  destructionGroups["feet"].push(node_foot_s_17);
  const socket_foot_s_ground_contact_0 = new THREE.Object3D();
  socket_foot_s_ground_contact_0.name = "ground-contact";
  socket_foot_s_ground_contact_0.position.set(0.0, 0.0, 0.05);
  socket_foot_s_ground_contact_0.rotation.set(0, 0, 0);
  socket_foot_s_ground_contact_0.userData.socket = {"id": "ground-contact", "localPosition": [0, 0, 0.05]};
  node_foot_s_17.add(socket_foot_s_ground_contact_0);
  sockets["foot-s:ground-contact"] = socket_foot_s_ground_contact_0;

  const endpoint_bracket_wall_s_18 = makeAttachmentEndpoint(null);
  const node_bracket_wall_s_18 = new THREE.Group();
  node_bracket_wall_s_18.name = "Bracket wall plate (s)__pivot";
  node_bracket_wall_s_18.scale.set(1, 1, 1);
  if (endpoint_bracket_wall_s_18) {
    node_bracket_wall_s_18.position.copy(endpoint_bracket_wall_s_18.start);
    node_bracket_wall_s_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bracket_wall_s_18.position.set(0.0, 0.0, 0.466);
    node_bracket_wall_s_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_bracket_wall_s_18.userData.sculptComponent = {"id": "bracket-wall-s", "name": "Bracket wall plate (s)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, 0, 0.466], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_s_18.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_wall_s_18);
  nodes["bracket-wall-s"] = node_bracket_wall_s_18;
  const mesh_bracket_wall_s_18Geometry = endpoint_bracket_wall_s_18
    ? new THREE.CylinderGeometry(endpoint_bracket_wall_s_18.endRadius, endpoint_bracket_wall_s_18.baseRadius, endpoint_bracket_wall_s_18.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_wall_s_18) {
    mesh_bracket_wall_s_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_wall_s_18 = new THREE.Mesh(
    mesh_bracket_wall_s_18Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_wall_s_18.name = "Bracket wall plate (s)";
  if (endpoint_bracket_wall_s_18) {
    mesh_bracket_wall_s_18.position.copy(endpoint_bracket_wall_s_18.midpoint);
    mesh_bracket_wall_s_18.quaternion.copy(endpoint_bracket_wall_s_18.quaternion);
  }
  mesh_bracket_wall_s_18.castShadow = options.castShadow ?? true;
  mesh_bracket_wall_s_18.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_wall_s_18.userData.sculptComponent = {"id": "bracket-wall-s", "name": "Bracket wall plate (s)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, 0, 0.466], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_s_18.add(mesh_bracket_wall_s_18);
  meshes["bracket-wall-s"] = mesh_bracket_wall_s_18;
  colliders["bracket-wall-s"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_wall_s_18);

  const endpoint_bracket_inner_s_19 = makeAttachmentEndpoint(null);
  const node_bracket_inner_s_19 = new THREE.Group();
  node_bracket_inner_s_19.name = "Bracket inner wall plate (s)__pivot";
  node_bracket_inner_s_19.scale.set(1, 1, 1);
  if (endpoint_bracket_inner_s_19) {
    node_bracket_inner_s_19.position.copy(endpoint_bracket_inner_s_19.start);
    node_bracket_inner_s_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bracket_inner_s_19.position.set(0.0, 0.0, 0.432);
    node_bracket_inner_s_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_bracket_inner_s_19.userData.sculptComponent = {"id": "bracket-inner-s", "name": "Bracket inner wall plate (s)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [0.0, 0, 0.432], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_s_19.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_inner_s_19);
  nodes["bracket-inner-s"] = node_bracket_inner_s_19;
  const mesh_bracket_inner_s_19Geometry = endpoint_bracket_inner_s_19
    ? new THREE.CylinderGeometry(endpoint_bracket_inner_s_19.endRadius, endpoint_bracket_inner_s_19.baseRadius, endpoint_bracket_inner_s_19.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_inner_s_19) {
    mesh_bracket_inner_s_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_inner_s_19 = new THREE.Mesh(
    mesh_bracket_inner_s_19Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_inner_s_19.name = "Bracket inner wall plate (s)";
  if (endpoint_bracket_inner_s_19) {
    mesh_bracket_inner_s_19.position.copy(endpoint_bracket_inner_s_19.midpoint);
    mesh_bracket_inner_s_19.quaternion.copy(endpoint_bracket_inner_s_19.quaternion);
  }
  mesh_bracket_inner_s_19.castShadow = options.castShadow ?? true;
  mesh_bracket_inner_s_19.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_inner_s_19.userData.sculptComponent = {"id": "bracket-inner-s", "name": "Bracket inner wall plate (s)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [0.0, 0, 0.432], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_s_19.add(mesh_bracket_inner_s_19);
  meshes["bracket-inner-s"] = mesh_bracket_inner_s_19;
  colliders["bracket-inner-s"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_inner_s_19);

  const endpoint_bracket_top_s_20 = makeAttachmentEndpoint(null);
  const node_bracket_top_s_20 = new THREE.Group();
  node_bracket_top_s_20.name = "Bracket top plate (s)__pivot";
  node_bracket_top_s_20.scale.set(1, 1, 1);
  if (endpoint_bracket_top_s_20) {
    node_bracket_top_s_20.position.copy(endpoint_bracket_top_s_20.start);
    node_bracket_top_s_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bracket_top_s_20.position.set(0.0, -0.006, 0.395);
    node_bracket_top_s_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_bracket_top_s_20.userData.sculptComponent = {"id": "bracket-top-s", "name": "Bracket top plate (s)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, -0.006, 0.395], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_s_20.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_top_s_20);
  nodes["bracket-top-s"] = node_bracket_top_s_20;
  const mesh_bracket_top_s_20Geometry = endpoint_bracket_top_s_20
    ? new THREE.CylinderGeometry(endpoint_bracket_top_s_20.endRadius, endpoint_bracket_top_s_20.baseRadius, endpoint_bracket_top_s_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bracket_top_s_20) {
    mesh_bracket_top_s_20Geometry.scale(0.15, 0.01, 0.11);
  }
  const mesh_bracket_top_s_20 = new THREE.Mesh(
    mesh_bracket_top_s_20Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_s_20.name = "Bracket top plate (s)";
  if (endpoint_bracket_top_s_20) {
    mesh_bracket_top_s_20.position.copy(endpoint_bracket_top_s_20.midpoint);
    mesh_bracket_top_s_20.quaternion.copy(endpoint_bracket_top_s_20.quaternion);
  }
  mesh_bracket_top_s_20.castShadow = options.castShadow ?? true;
  mesh_bracket_top_s_20.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_s_20.userData.sculptComponent = {"id": "bracket-top-s", "name": "Bracket top plate (s)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [0.0, -0.006, 0.395], "rotation": [0, 0.0, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-s"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_s_20.add(mesh_bracket_top_s_20);
  meshes["bracket-top-s"] = mesh_bracket_top_s_20;
  colliders["bracket-top-s"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_top_s_20);

  const endpoint_foot_w_21 = makeAttachmentEndpoint(null);
  const node_foot_w_21 = new THREE.Group();
  node_foot_w_21.name = "Wedge foot (w)__pivot";
  node_foot_w_21.scale.set(1, 1, 1);
  if (endpoint_foot_w_21) {
    node_foot_w_21.position.copy(endpoint_foot_w_21.start);
    node_foot_w_21.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_foot_w_21.position.set(-0.395, 0.0, 0.0);
    node_foot_w_21.rotation.set(0.0, -1.5708, 0.0);
  }
  node_foot_w_21.userData.sculptComponent = {"id": "foot-w", "name": "Wedge foot (w)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.395, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_w_21.userData.actionProfile = {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["foot-mount"] ?? root).add(node_foot_w_21);
  nodes["foot-w"] = node_foot_w_21;
  const mesh_foot_w_21Geometry = endpoint_foot_w_21
    ? new THREE.CylinderGeometry(endpoint_foot_w_21.endRadius, endpoint_foot_w_21.baseRadius, endpoint_foot_w_21.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1});
  if (!endpoint_foot_w_21) {
    mesh_foot_w_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_foot_w_21 = new THREE.Mesh(
    mesh_foot_w_21Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_w_21.name = "Wedge foot (w)";
  if (endpoint_foot_w_21) {
    mesh_foot_w_21.position.copy(endpoint_foot_w_21.midpoint);
    mesh_foot_w_21.quaternion.copy(endpoint_foot_w_21.quaternion);
  }
  mesh_foot_w_21.castShadow = options.castShadow ?? true;
  mesh_foot_w_21.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_w_21.userData.sculptComponent = {"id": "foot-w", "name": "Wedge foot (w)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.395, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_w_21.add(mesh_foot_w_21);
  meshes["foot-w"] = mesh_foot_w_21;
  colliders["foot-w"] = {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["feet"] ??= [];
  destructionGroups["feet"].push(node_foot_w_21);
  const socket_foot_w_ground_contact_0 = new THREE.Object3D();
  socket_foot_w_ground_contact_0.name = "ground-contact";
  socket_foot_w_ground_contact_0.position.set(0.0, 0.0, 0.05);
  socket_foot_w_ground_contact_0.rotation.set(0, 0, 0);
  socket_foot_w_ground_contact_0.userData.socket = {"id": "ground-contact", "localPosition": [0, 0, 0.05]};
  node_foot_w_21.add(socket_foot_w_ground_contact_0);
  sockets["foot-w:ground-contact"] = socket_foot_w_ground_contact_0;

  const endpoint_bracket_wall_w_22 = makeAttachmentEndpoint(null);
  const node_bracket_wall_w_22 = new THREE.Group();
  node_bracket_wall_w_22.name = "Bracket wall plate (w)__pivot";
  node_bracket_wall_w_22.scale.set(1, 1, 1);
  if (endpoint_bracket_wall_w_22) {
    node_bracket_wall_w_22.position.copy(endpoint_bracket_wall_w_22.start);
    node_bracket_wall_w_22.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_bracket_wall_w_22.position.set(-0.466, 0.0, 0.0);
    node_bracket_wall_w_22.rotation.set(0.0, -1.5708, 0.0);
  }
  node_bracket_wall_w_22.userData.sculptComponent = {"id": "bracket-wall-w", "name": "Bracket wall plate (w)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.466, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_w_22.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_wall_w_22);
  nodes["bracket-wall-w"] = node_bracket_wall_w_22;
  const mesh_bracket_wall_w_22Geometry = endpoint_bracket_wall_w_22
    ? new THREE.CylinderGeometry(endpoint_bracket_wall_w_22.endRadius, endpoint_bracket_wall_w_22.baseRadius, endpoint_bracket_wall_w_22.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_wall_w_22) {
    mesh_bracket_wall_w_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_wall_w_22 = new THREE.Mesh(
    mesh_bracket_wall_w_22Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_wall_w_22.name = "Bracket wall plate (w)";
  if (endpoint_bracket_wall_w_22) {
    mesh_bracket_wall_w_22.position.copy(endpoint_bracket_wall_w_22.midpoint);
    mesh_bracket_wall_w_22.quaternion.copy(endpoint_bracket_wall_w_22.quaternion);
  }
  mesh_bracket_wall_w_22.castShadow = options.castShadow ?? true;
  mesh_bracket_wall_w_22.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_wall_w_22.userData.sculptComponent = {"id": "bracket-wall-w", "name": "Bracket wall plate (w)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.466, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_w_22.add(mesh_bracket_wall_w_22);
  meshes["bracket-wall-w"] = mesh_bracket_wall_w_22;
  colliders["bracket-wall-w"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_wall_w_22);

  const endpoint_bracket_inner_w_23 = makeAttachmentEndpoint(null);
  const node_bracket_inner_w_23 = new THREE.Group();
  node_bracket_inner_w_23.name = "Bracket inner wall plate (w)__pivot";
  node_bracket_inner_w_23.scale.set(1, 1, 1);
  if (endpoint_bracket_inner_w_23) {
    node_bracket_inner_w_23.position.copy(endpoint_bracket_inner_w_23.start);
    node_bracket_inner_w_23.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_bracket_inner_w_23.position.set(-0.432, 0.0, 0.0);
    node_bracket_inner_w_23.rotation.set(0.0, -1.5708, 0.0);
  }
  node_bracket_inner_w_23.userData.sculptComponent = {"id": "bracket-inner-w", "name": "Bracket inner wall plate (w)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [-0.432, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_w_23.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_inner_w_23);
  nodes["bracket-inner-w"] = node_bracket_inner_w_23;
  const mesh_bracket_inner_w_23Geometry = endpoint_bracket_inner_w_23
    ? new THREE.CylinderGeometry(endpoint_bracket_inner_w_23.endRadius, endpoint_bracket_inner_w_23.baseRadius, endpoint_bracket_inner_w_23.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_inner_w_23) {
    mesh_bracket_inner_w_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_inner_w_23 = new THREE.Mesh(
    mesh_bracket_inner_w_23Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_inner_w_23.name = "Bracket inner wall plate (w)";
  if (endpoint_bracket_inner_w_23) {
    mesh_bracket_inner_w_23.position.copy(endpoint_bracket_inner_w_23.midpoint);
    mesh_bracket_inner_w_23.quaternion.copy(endpoint_bracket_inner_w_23.quaternion);
  }
  mesh_bracket_inner_w_23.castShadow = options.castShadow ?? true;
  mesh_bracket_inner_w_23.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_inner_w_23.userData.sculptComponent = {"id": "bracket-inner-w", "name": "Bracket inner wall plate (w)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [-0.432, 0, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_w_23.add(mesh_bracket_inner_w_23);
  meshes["bracket-inner-w"] = mesh_bracket_inner_w_23;
  colliders["bracket-inner-w"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_inner_w_23);

  const endpoint_bracket_top_w_24 = makeAttachmentEndpoint(null);
  const node_bracket_top_w_24 = new THREE.Group();
  node_bracket_top_w_24.name = "Bracket top plate (w)__pivot";
  node_bracket_top_w_24.scale.set(1, 1, 1);
  if (endpoint_bracket_top_w_24) {
    node_bracket_top_w_24.position.copy(endpoint_bracket_top_w_24.start);
    node_bracket_top_w_24.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_bracket_top_w_24.position.set(-0.395, -0.006, 0.0);
    node_bracket_top_w_24.rotation.set(0.0, -1.5708, 0.0);
  }
  node_bracket_top_w_24.userData.sculptComponent = {"id": "bracket-top-w", "name": "Bracket top plate (w)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.395, -0.006, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_w_24.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_top_w_24);
  nodes["bracket-top-w"] = node_bracket_top_w_24;
  const mesh_bracket_top_w_24Geometry = endpoint_bracket_top_w_24
    ? new THREE.CylinderGeometry(endpoint_bracket_top_w_24.endRadius, endpoint_bracket_top_w_24.baseRadius, endpoint_bracket_top_w_24.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bracket_top_w_24) {
    mesh_bracket_top_w_24Geometry.scale(0.15, 0.01, 0.11);
  }
  const mesh_bracket_top_w_24 = new THREE.Mesh(
    mesh_bracket_top_w_24Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_w_24.name = "Bracket top plate (w)";
  if (endpoint_bracket_top_w_24) {
    mesh_bracket_top_w_24.position.copy(endpoint_bracket_top_w_24.midpoint);
    mesh_bracket_top_w_24.quaternion.copy(endpoint_bracket_top_w_24.quaternion);
  }
  mesh_bracket_top_w_24.castShadow = options.castShadow ?? true;
  mesh_bracket_top_w_24.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_w_24.userData.sculptComponent = {"id": "bracket-top-w", "name": "Bracket top plate (w)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.395, -0.006, 0.0], "rotation": [0, -1.5708, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-w"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_w_24.add(mesh_bracket_top_w_24);
  meshes["bracket-top-w"] = mesh_bracket_top_w_24;
  colliders["bracket-top-w"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_top_w_24);

  const endpoint_foot_n_25 = makeAttachmentEndpoint(null);
  const node_foot_n_25 = new THREE.Group();
  node_foot_n_25.name = "Wedge foot (n)__pivot";
  node_foot_n_25.scale.set(1, 1, 1);
  if (endpoint_foot_n_25) {
    node_foot_n_25.position.copy(endpoint_foot_n_25.start);
    node_foot_n_25.rotation.set(0.0, -3.1416, 0.0);
  } else {
    node_foot_n_25.position.set(-0.0, 0.0, -0.395);
    node_foot_n_25.rotation.set(0.0, -3.1416, 0.0);
  }
  node_foot_n_25.userData.sculptComponent = {"id": "foot-n", "name": "Wedge foot (n)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, 0, -0.395], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_n_25.userData.actionProfile = {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["foot-mount"] ?? root).add(node_foot_n_25);
  nodes["foot-n"] = node_foot_n_25;
  const mesh_foot_n_25Geometry = endpoint_foot_n_25
    ? new THREE.CylinderGeometry(endpoint_foot_n_25.endRadius, endpoint_foot_n_25.baseRadius, endpoint_foot_n_25.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1});
  if (!endpoint_foot_n_25) {
    mesh_foot_n_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_foot_n_25 = new THREE.Mesh(
    mesh_foot_n_25Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_n_25.name = "Wedge foot (n)";
  if (endpoint_foot_n_25) {
    mesh_foot_n_25.position.copy(endpoint_foot_n_25.midpoint);
    mesh_foot_n_25.quaternion.copy(endpoint_foot_n_25.quaternion);
  }
  mesh_foot_n_25.castShadow = options.castShadow ?? true;
  mesh_foot_n_25.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_n_25.userData.sculptComponent = {"id": "foot-n", "name": "Wedge foot (n)", "level": "macro", "role": "foot", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Wedge foot: trapezoid face profile extruded radially (extrude of a 2D section).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, 0], [0.085, 0], [0.062, 0.1], [-0.062, 0.1]], "depth": 0.1}}, "parent": "foot-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, 0, -0.395], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "foot", "pivot": {"mode": "base", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ground-contact", "localPosition": [0, 0, 0.05]}], "collider": {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "feet", "seamRefs": ["foot-mount"], "detachableFragments": ["foot-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_n_25.add(mesh_foot_n_25);
  meshes["foot-n"] = mesh_foot_n_25;
  colliders["foot-n"] = {"type": "box", "offset": [0, 0.05, 0.05], "scale": [0.17, 0.1, 0.1], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["feet"] ??= [];
  destructionGroups["feet"].push(node_foot_n_25);
  const socket_foot_n_ground_contact_0 = new THREE.Object3D();
  socket_foot_n_ground_contact_0.name = "ground-contact";
  socket_foot_n_ground_contact_0.position.set(0.0, 0.0, 0.05);
  socket_foot_n_ground_contact_0.rotation.set(0, 0, 0);
  socket_foot_n_ground_contact_0.userData.socket = {"id": "ground-contact", "localPosition": [0, 0, 0.05]};
  node_foot_n_25.add(socket_foot_n_ground_contact_0);
  sockets["foot-n:ground-contact"] = socket_foot_n_ground_contact_0;

  const endpoint_bracket_wall_n_26 = makeAttachmentEndpoint(null);
  const node_bracket_wall_n_26 = new THREE.Group();
  node_bracket_wall_n_26.name = "Bracket wall plate (n)__pivot";
  node_bracket_wall_n_26.scale.set(1, 1, 1);
  if (endpoint_bracket_wall_n_26) {
    node_bracket_wall_n_26.position.copy(endpoint_bracket_wall_n_26.start);
    node_bracket_wall_n_26.rotation.set(0.0, -3.1416, 0.0);
  } else {
    node_bracket_wall_n_26.position.set(-0.0, 0.0, -0.466);
    node_bracket_wall_n_26.rotation.set(0.0, -3.1416, 0.0);
  }
  node_bracket_wall_n_26.userData.sculptComponent = {"id": "bracket-wall-n", "name": "Bracket wall plate (n)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, 0, -0.466], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_n_26.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_wall_n_26);
  nodes["bracket-wall-n"] = node_bracket_wall_n_26;
  const mesh_bracket_wall_n_26Geometry = endpoint_bracket_wall_n_26
    ? new THREE.CylinderGeometry(endpoint_bracket_wall_n_26.endRadius, endpoint_bracket_wall_n_26.baseRadius, endpoint_bracket_wall_n_26.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_wall_n_26) {
    mesh_bracket_wall_n_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_wall_n_26 = new THREE.Mesh(
    mesh_bracket_wall_n_26Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_wall_n_26.name = "Bracket wall plate (n)";
  if (endpoint_bracket_wall_n_26) {
    mesh_bracket_wall_n_26.position.copy(endpoint_bracket_wall_n_26.midpoint);
    mesh_bracket_wall_n_26.quaternion.copy(endpoint_bracket_wall_n_26.quaternion);
  }
  mesh_bracket_wall_n_26.castShadow = options.castShadow ?? true;
  mesh_bracket_wall_n_26.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_wall_n_26.userData.sculptComponent = {"id": "bracket-wall-n", "name": "Bracket wall plate (n)", "level": "macro", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped over the rim wall: trapezoid extrude.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.075, -0.057], [0.075, -0.057], [0.085, 0.073], [-0.085, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, 0, -0.466], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-wall-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_wall_n_26.add(mesh_bracket_wall_n_26);
  meshes["bracket-wall-n"] = mesh_bracket_wall_n_26;
  colliders["bracket-wall-n"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_wall_n_26);

  const endpoint_bracket_inner_n_27 = makeAttachmentEndpoint(null);
  const node_bracket_inner_n_27 = new THREE.Group();
  node_bracket_inner_n_27.name = "Bracket inner wall plate (n)__pivot";
  node_bracket_inner_n_27.scale.set(1, 1, 1);
  if (endpoint_bracket_inner_n_27) {
    node_bracket_inner_n_27.position.copy(endpoint_bracket_inner_n_27.start);
    node_bracket_inner_n_27.rotation.set(0.0, -3.1416, 0.0);
  } else {
    node_bracket_inner_n_27.position.set(-0.0, 0.0, -0.432);
    node_bracket_inner_n_27.rotation.set(0.0, -3.1416, 0.0);
  }
  node_bracket_inner_n_27.userData.sculptComponent = {"id": "bracket-inner-n", "name": "Bracket inner wall plate (n)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [-0.0, 0, -0.432], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_n_27.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_inner_n_27);
  nodes["bracket-inner-n"] = node_bracket_inner_n_27;
  const mesh_bracket_inner_n_27Geometry = endpoint_bracket_inner_n_27
    ? new THREE.CylinderGeometry(endpoint_bracket_inner_n_27.endRadius, endpoint_bracket_inner_n_27.baseRadius, endpoint_bracket_inner_n_27.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012});
  if (!endpoint_bracket_inner_n_27) {
    mesh_bracket_inner_n_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bracket_inner_n_27 = new THREE.Mesh(
    mesh_bracket_inner_n_27Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_inner_n_27.name = "Bracket inner wall plate (n)";
  if (endpoint_bracket_inner_n_27) {
    mesh_bracket_inner_n_27.position.copy(endpoint_bracket_inner_n_27.midpoint);
    mesh_bracket_inner_n_27.quaternion.copy(endpoint_bracket_inner_n_27.quaternion);
  }
  mesh_bracket_inner_n_27.castShadow = options.castShadow ?? true;
  mesh_bracket_inner_n_27.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_inner_n_27.userData.sculptComponent = {"id": "bracket-inner-n", "name": "Bracket inner wall plate (n)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Plate clipped on the rim inner wall: trapezoid extrude (wider at the net, narrower at rim top).", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.085, -0.012], [0.085, -0.012], [0.06, 0.073], [-0.06, 0.073]], "depth": 0.012}}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "meters", "confidence": 0.6}, "transform": {"position": [-0.0, 0, -0.432], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-inner-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_inner_n_27.add(mesh_bracket_inner_n_27);
  meshes["bracket-inner-n"] = mesh_bracket_inner_n_27;
  colliders["bracket-inner-n"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_inner_n_27);

  const endpoint_bracket_top_n_28 = makeAttachmentEndpoint(null);
  const node_bracket_top_n_28 = new THREE.Group();
  node_bracket_top_n_28.name = "Bracket top plate (n)__pivot";
  node_bracket_top_n_28.scale.set(1, 1, 1);
  if (endpoint_bracket_top_n_28) {
    node_bracket_top_n_28.position.copy(endpoint_bracket_top_n_28.start);
    node_bracket_top_n_28.rotation.set(0.0, -3.1416, 0.0);
  } else {
    node_bracket_top_n_28.position.set(-0.0, -0.006, -0.395);
    node_bracket_top_n_28.rotation.set(0.0, -3.1416, 0.0);
  }
  node_bracket_top_n_28.userData.sculptComponent = {"id": "bracket-top-n", "name": "Bracket top plate (n)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, -0.006, -0.395], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_n_28.userData.actionProfile = {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}};
  (nodes["bracket-mount"] ?? root).add(node_bracket_top_n_28);
  nodes["bracket-top-n"] = node_bracket_top_n_28;
  const mesh_bracket_top_n_28Geometry = endpoint_bracket_top_n_28
    ? new THREE.CylinderGeometry(endpoint_bracket_top_n_28.endRadius, endpoint_bracket_top_n_28.baseRadius, endpoint_bracket_top_n_28.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bracket_top_n_28) {
    mesh_bracket_top_n_28Geometry.scale(0.15, 0.01, 0.11);
  }
  const mesh_bracket_top_n_28 = new THREE.Mesh(
    mesh_bracket_top_n_28Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_n_28.name = "Bracket top plate (n)";
  if (endpoint_bracket_top_n_28) {
    mesh_bracket_top_n_28.position.copy(endpoint_bracket_top_n_28.midpoint);
    mesh_bracket_top_n_28.quaternion.copy(endpoint_bracket_top_n_28.quaternion);
  }
  mesh_bracket_top_n_28.castShadow = options.castShadow ?? true;
  mesh_bracket_top_n_28.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_n_28.userData.sculptComponent = {"id": "bracket-top-n", "name": "Bracket top plate (n)", "level": "meso", "role": "bracket", "importance": 1.0, "confidence": 0.65, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat plate lying on the net inside the rim: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-mount", "attachment": null, "dimensions": {"width": 0.15, "height": 0.01, "depth": 0.11, "units": "meters", "confidence": 0.65}, "transform": {"position": [-0.0, -0.006, -0.395], "rotation": [0, -3.1416, 0]}, "actionProfile": {"animationRole": "bracket", "pivot": {"mode": "hinge", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "brackets", "seamRefs": ["bracket-mount"], "detachableFragments": ["bracket-top-n"], "breakImpulse": 4.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.1, "bumpAmplitude": 0.03, "normalPattern": "fine moulded grain (seeded, tileable)", "displacementPattern": "none", "occlusionPattern": "AO at plate/rim contact", "edgeWearPattern": "none visible in photo", "notes": "injection-moulded satin plastic, slightly glossier faces on feet"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(38, 38, 38, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_bracket_top_n_28.add(mesh_bracket_top_n_28);
  meshes["bracket-top-n"] = mesh_bracket_top_n_28;
  colliders["bracket-top-n"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.15, 0.13, 0.05], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["brackets"] ??= [];
  destructionGroups["brackets"].push(node_bracket_top_n_28);

  const endpoint_titan_plate_29 = makeAttachmentEndpoint(null);
  const node_titan_plate_29 = new THREE.Group();
  node_titan_plate_29.name = "TITAN letter block 0__pivot";
  node_titan_plate_29.scale.set(1, 1, 1);
  if (endpoint_titan_plate_29) {
    node_titan_plate_29.position.copy(endpoint_titan_plate_29.start);
    node_titan_plate_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_titan_plate_29.position.set(-0.04, 0.012, 0.0135);
    node_titan_plate_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_titan_plate_29.userData.sculptComponent = {"id": "titan-plate", "name": "TITAN letter block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [-0.04, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "titan-text", "type": "decal", "note": "yellow TITAN lettering as 5 letter blocks, stylised"}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_plate_29.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["bracket-wall-s"] ?? root).add(node_titan_plate_29);
  nodes["titan-plate"] = node_titan_plate_29;
  const mesh_titan_plate_29Geometry = endpoint_titan_plate_29
    ? new THREE.CylinderGeometry(endpoint_titan_plate_29.endRadius, endpoint_titan_plate_29.baseRadius, endpoint_titan_plate_29.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_titan_plate_29) {
    mesh_titan_plate_29Geometry.scale(0.013, 0.024, 0.003);
  }
  const mesh_titan_plate_29 = new THREE.Mesh(
    mesh_titan_plate_29Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_titan_plate_29.name = "TITAN letter block 0";
  if (endpoint_titan_plate_29) {
    mesh_titan_plate_29.position.copy(endpoint_titan_plate_29.midpoint);
    mesh_titan_plate_29.quaternion.copy(endpoint_titan_plate_29.quaternion);
  }
  mesh_titan_plate_29.castShadow = options.castShadow ?? true;
  mesh_titan_plate_29.receiveShadow = options.receiveShadow ?? true;
  mesh_titan_plate_29.userData.sculptComponent = {"id": "titan-plate", "name": "TITAN letter block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [-0.04, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "titan-text", "type": "decal", "note": "yellow TITAN lettering as 5 letter blocks, stylised"}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_plate_29.add(mesh_titan_plate_29);
  meshes["titan-plate"] = mesh_titan_plate_29;
  colliders["titan-plate"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_titan_plate_29);

  const endpoint_titan_1_30 = makeAttachmentEndpoint(null);
  const node_titan_1_30 = new THREE.Group();
  node_titan_1_30.name = "TITAN letter block 1__pivot";
  node_titan_1_30.scale.set(1, 1, 1);
  if (endpoint_titan_1_30) {
    node_titan_1_30.position.copy(endpoint_titan_1_30.start);
    node_titan_1_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_titan_1_30.position.set(-0.02, 0.012, 0.0135);
    node_titan_1_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_titan_1_30.userData.sculptComponent = {"id": "titan-1", "name": "TITAN letter block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [-0.02, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_1_30.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["bracket-wall-s"] ?? root).add(node_titan_1_30);
  nodes["titan-1"] = node_titan_1_30;
  const mesh_titan_1_30Geometry = endpoint_titan_1_30
    ? new THREE.CylinderGeometry(endpoint_titan_1_30.endRadius, endpoint_titan_1_30.baseRadius, endpoint_titan_1_30.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_titan_1_30) {
    mesh_titan_1_30Geometry.scale(0.013, 0.024, 0.003);
  }
  const mesh_titan_1_30 = new THREE.Mesh(
    mesh_titan_1_30Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_titan_1_30.name = "TITAN letter block 1";
  if (endpoint_titan_1_30) {
    mesh_titan_1_30.position.copy(endpoint_titan_1_30.midpoint);
    mesh_titan_1_30.quaternion.copy(endpoint_titan_1_30.quaternion);
  }
  mesh_titan_1_30.castShadow = options.castShadow ?? true;
  mesh_titan_1_30.receiveShadow = options.receiveShadow ?? true;
  mesh_titan_1_30.userData.sculptComponent = {"id": "titan-1", "name": "TITAN letter block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [-0.02, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_1_30.add(mesh_titan_1_30);
  meshes["titan-1"] = mesh_titan_1_30;
  colliders["titan-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_titan_1_30);

  const endpoint_titan_2_31 = makeAttachmentEndpoint(null);
  const node_titan_2_31 = new THREE.Group();
  node_titan_2_31.name = "TITAN letter block 2__pivot";
  node_titan_2_31.scale.set(1, 1, 1);
  if (endpoint_titan_2_31) {
    node_titan_2_31.position.copy(endpoint_titan_2_31.start);
    node_titan_2_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_titan_2_31.position.set(0.0, 0.012, 0.0135);
    node_titan_2_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_titan_2_31.userData.sculptComponent = {"id": "titan-2", "name": "TITAN letter block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.0, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_2_31.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["bracket-wall-s"] ?? root).add(node_titan_2_31);
  nodes["titan-2"] = node_titan_2_31;
  const mesh_titan_2_31Geometry = endpoint_titan_2_31
    ? new THREE.CylinderGeometry(endpoint_titan_2_31.endRadius, endpoint_titan_2_31.baseRadius, endpoint_titan_2_31.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_titan_2_31) {
    mesh_titan_2_31Geometry.scale(0.013, 0.024, 0.003);
  }
  const mesh_titan_2_31 = new THREE.Mesh(
    mesh_titan_2_31Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_titan_2_31.name = "TITAN letter block 2";
  if (endpoint_titan_2_31) {
    mesh_titan_2_31.position.copy(endpoint_titan_2_31.midpoint);
    mesh_titan_2_31.quaternion.copy(endpoint_titan_2_31.quaternion);
  }
  mesh_titan_2_31.castShadow = options.castShadow ?? true;
  mesh_titan_2_31.receiveShadow = options.receiveShadow ?? true;
  mesh_titan_2_31.userData.sculptComponent = {"id": "titan-2", "name": "TITAN letter block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.0, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_2_31.add(mesh_titan_2_31);
  meshes["titan-2"] = mesh_titan_2_31;
  colliders["titan-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_titan_2_31);

  const endpoint_titan_3_32 = makeAttachmentEndpoint(null);
  const node_titan_3_32 = new THREE.Group();
  node_titan_3_32.name = "TITAN letter block 3__pivot";
  node_titan_3_32.scale.set(1, 1, 1);
  if (endpoint_titan_3_32) {
    node_titan_3_32.position.copy(endpoint_titan_3_32.start);
    node_titan_3_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_titan_3_32.position.set(0.02, 0.012, 0.0135);
    node_titan_3_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_titan_3_32.userData.sculptComponent = {"id": "titan-3", "name": "TITAN letter block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.02, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_3_32.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["bracket-wall-s"] ?? root).add(node_titan_3_32);
  nodes["titan-3"] = node_titan_3_32;
  const mesh_titan_3_32Geometry = endpoint_titan_3_32
    ? new THREE.CylinderGeometry(endpoint_titan_3_32.endRadius, endpoint_titan_3_32.baseRadius, endpoint_titan_3_32.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_titan_3_32) {
    mesh_titan_3_32Geometry.scale(0.013, 0.024, 0.003);
  }
  const mesh_titan_3_32 = new THREE.Mesh(
    mesh_titan_3_32Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_titan_3_32.name = "TITAN letter block 3";
  if (endpoint_titan_3_32) {
    mesh_titan_3_32.position.copy(endpoint_titan_3_32.midpoint);
    mesh_titan_3_32.quaternion.copy(endpoint_titan_3_32.quaternion);
  }
  mesh_titan_3_32.castShadow = options.castShadow ?? true;
  mesh_titan_3_32.receiveShadow = options.receiveShadow ?? true;
  mesh_titan_3_32.userData.sculptComponent = {"id": "titan-3", "name": "TITAN letter block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.02, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_3_32.add(mesh_titan_3_32);
  meshes["titan-3"] = mesh_titan_3_32;
  colliders["titan-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_titan_3_32);

  const endpoint_titan_4_33 = makeAttachmentEndpoint(null);
  const node_titan_4_33 = new THREE.Group();
  node_titan_4_33.name = "TITAN letter block 4__pivot";
  node_titan_4_33.scale.set(1, 1, 1);
  if (endpoint_titan_4_33) {
    node_titan_4_33.position.copy(endpoint_titan_4_33.start);
    node_titan_4_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_titan_4_33.position.set(0.04, 0.012, 0.0135);
    node_titan_4_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_titan_4_33.userData.sculptComponent = {"id": "titan-4", "name": "TITAN letter block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.04, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_4_33.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["bracket-wall-s"] ?? root).add(node_titan_4_33);
  nodes["titan-4"] = node_titan_4_33;
  const mesh_titan_4_33Geometry = endpoint_titan_4_33
    ? new THREE.CylinderGeometry(endpoint_titan_4_33.endRadius, endpoint_titan_4_33.baseRadius, endpoint_titan_4_33.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_titan_4_33) {
    mesh_titan_4_33Geometry.scale(0.013, 0.024, 0.003);
  }
  const mesh_titan_4_33 = new THREE.Mesh(
    mesh_titan_4_33Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_titan_4_33.name = "TITAN letter block 4";
  if (endpoint_titan_4_33) {
    mesh_titan_4_33.position.copy(endpoint_titan_4_33.midpoint);
    mesh_titan_4_33.quaternion.copy(endpoint_titan_4_33.quaternion);
  }
  mesh_titan_4_33.castShadow = options.castShadow ?? true;
  mesh_titan_4_33.receiveShadow = options.receiveShadow ?? true;
  mesh_titan_4_33.userData.sculptComponent = {"id": "titan-4", "name": "TITAN letter block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Printed letter block on the near bracket wall: flat box decal.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-wall-s", "attachment": null, "dimensions": {"width": 0.013, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.55}, "transform": {"position": [0.04, 0.012, 0.0135], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_titan_4_33.add(mesh_titan_4_33);
  meshes["titan-4"] = mesh_titan_4_33;
  colliders["titan-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_titan_4_33);

  const endpoint_s_logo_34 = makeAttachmentEndpoint(null);
  const node_s_logo_34 = new THREE.Group();
  node_s_logo_34.name = "S roundel ring on near foot__pivot";
  node_s_logo_34.scale.set(1, 1, 1);
  if (endpoint_s_logo_34) {
    node_s_logo_34.position.copy(endpoint_s_logo_34.start);
    node_s_logo_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_s_logo_34.position.set(0.0, 0.05, 0.1);
    node_s_logo_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_s_logo_34.userData.sculptComponent = {"id": "s-logo", "name": "S roundel ring on near foot", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.6, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring of the S roundel on the foot face: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.18}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.6}, "transform": {"position": [0, 0.05, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "s-roundel", "type": "decal", "note": "yellow ring + three-bar bolt standing in for the S glyph"}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_logo_34.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["foot-s"] ?? root).add(node_s_logo_34);
  nodes["s-logo"] = node_s_logo_34;
  const mesh_s_logo_34Geometry = endpoint_s_logo_34
    ? new THREE.CylinderGeometry(endpoint_s_logo_34.endRadius, endpoint_s_logo_34.baseRadius, endpoint_s_logo_34.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.081, 12, 48);
  if (!endpoint_s_logo_34) {
    mesh_s_logo_34Geometry.scale(0.09, 0.09, 0.09);
  }
  const mesh_s_logo_34 = new THREE.Mesh(
    mesh_s_logo_34Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_s_logo_34.name = "S roundel ring on near foot";
  if (endpoint_s_logo_34) {
    mesh_s_logo_34.position.copy(endpoint_s_logo_34.midpoint);
    mesh_s_logo_34.quaternion.copy(endpoint_s_logo_34.quaternion);
  }
  mesh_s_logo_34.castShadow = options.castShadow ?? true;
  mesh_s_logo_34.receiveShadow = options.receiveShadow ?? true;
  mesh_s_logo_34.userData.sculptComponent = {"id": "s-logo", "name": "S roundel ring on near foot", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.6, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Ring of the S roundel on the foot face: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.18}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.09, "height": 0.09, "depth": 0.09, "units": "meters", "confidence": 0.6}, "transform": {"position": [0, 0.05, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "s-roundel", "type": "decal", "note": "yellow ring + three-bar bolt standing in for the S glyph"}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_logo_34.add(mesh_s_logo_34);
  meshes["s-logo"] = mesh_s_logo_34;
  colliders["s-logo"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_s_logo_34);

  const endpoint_s_bolt_0_35 = makeAttachmentEndpoint(null);
  const node_s_bolt_0_35 = new THREE.Group();
  node_s_bolt_0_35.name = "S bolt bar 0__pivot";
  node_s_bolt_0_35.scale.set(1, 1, 1);
  if (endpoint_s_bolt_0_35) {
    node_s_bolt_0_35.position.copy(endpoint_s_bolt_0_35.start);
    node_s_bolt_0_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_s_bolt_0_35.position.set(0.0, 0.067, 0.1);
    node_s_bolt_0_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_s_bolt_0_35.userData.sculptComponent = {"id": "s-bolt-0", "name": "S bolt bar 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.067, 0.1], "rotation": [0, 0, 0.0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_0_35.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["foot-s"] ?? root).add(node_s_bolt_0_35);
  nodes["s-bolt-0"] = node_s_bolt_0_35;
  const mesh_s_bolt_0_35Geometry = endpoint_s_bolt_0_35
    ? new THREE.CylinderGeometry(endpoint_s_bolt_0_35.endRadius, endpoint_s_bolt_0_35.baseRadius, endpoint_s_bolt_0_35.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_s_bolt_0_35) {
    mesh_s_bolt_0_35Geometry.scale(0.05, 0.011, 0.004);
  }
  const mesh_s_bolt_0_35 = new THREE.Mesh(
    mesh_s_bolt_0_35Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_s_bolt_0_35.name = "S bolt bar 0";
  if (endpoint_s_bolt_0_35) {
    mesh_s_bolt_0_35.position.copy(endpoint_s_bolt_0_35.midpoint);
    mesh_s_bolt_0_35.quaternion.copy(endpoint_s_bolt_0_35.quaternion);
  }
  mesh_s_bolt_0_35.castShadow = options.castShadow ?? true;
  mesh_s_bolt_0_35.receiveShadow = options.receiveShadow ?? true;
  mesh_s_bolt_0_35.userData.sculptComponent = {"id": "s-bolt-0", "name": "S bolt bar 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.067, 0.1], "rotation": [0, 0, 0.0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_0_35.add(mesh_s_bolt_0_35);
  meshes["s-bolt-0"] = mesh_s_bolt_0_35;
  colliders["s-bolt-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_s_bolt_0_35);

  const endpoint_s_bolt_1_36 = makeAttachmentEndpoint(null);
  const node_s_bolt_1_36 = new THREE.Group();
  node_s_bolt_1_36.name = "S bolt bar 1__pivot";
  node_s_bolt_1_36.scale.set(1, 1, 1);
  if (endpoint_s_bolt_1_36) {
    node_s_bolt_1_36.position.copy(endpoint_s_bolt_1_36.start);
    node_s_bolt_1_36.rotation.set(0.0, 0.0, -0.55);
  } else {
    node_s_bolt_1_36.position.set(0.0, 0.05, 0.1);
    node_s_bolt_1_36.rotation.set(0.0, 0.0, -0.55);
  }
  node_s_bolt_1_36.userData.sculptComponent = {"id": "s-bolt-1", "name": "S bolt bar 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.05, 0.1], "rotation": [0, 0, -0.55]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_1_36.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["foot-s"] ?? root).add(node_s_bolt_1_36);
  nodes["s-bolt-1"] = node_s_bolt_1_36;
  const mesh_s_bolt_1_36Geometry = endpoint_s_bolt_1_36
    ? new THREE.CylinderGeometry(endpoint_s_bolt_1_36.endRadius, endpoint_s_bolt_1_36.baseRadius, endpoint_s_bolt_1_36.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_s_bolt_1_36) {
    mesh_s_bolt_1_36Geometry.scale(0.05, 0.011, 0.004);
  }
  const mesh_s_bolt_1_36 = new THREE.Mesh(
    mesh_s_bolt_1_36Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_s_bolt_1_36.name = "S bolt bar 1";
  if (endpoint_s_bolt_1_36) {
    mesh_s_bolt_1_36.position.copy(endpoint_s_bolt_1_36.midpoint);
    mesh_s_bolt_1_36.quaternion.copy(endpoint_s_bolt_1_36.quaternion);
  }
  mesh_s_bolt_1_36.castShadow = options.castShadow ?? true;
  mesh_s_bolt_1_36.receiveShadow = options.receiveShadow ?? true;
  mesh_s_bolt_1_36.userData.sculptComponent = {"id": "s-bolt-1", "name": "S bolt bar 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.05, 0.1], "rotation": [0, 0, -0.55]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_1_36.add(mesh_s_bolt_1_36);
  meshes["s-bolt-1"] = mesh_s_bolt_1_36;
  colliders["s-bolt-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_s_bolt_1_36);

  const endpoint_s_bolt_2_37 = makeAttachmentEndpoint(null);
  const node_s_bolt_2_37 = new THREE.Group();
  node_s_bolt_2_37.name = "S bolt bar 2__pivot";
  node_s_bolt_2_37.scale.set(1, 1, 1);
  if (endpoint_s_bolt_2_37) {
    node_s_bolt_2_37.position.copy(endpoint_s_bolt_2_37.start);
    node_s_bolt_2_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_s_bolt_2_37.position.set(0.0, 0.033, 0.1);
    node_s_bolt_2_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_s_bolt_2_37.userData.sculptComponent = {"id": "s-bolt-2", "name": "S bolt bar 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.033, 0.1], "rotation": [0, 0, 0.0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_2_37.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["foot-s"] ?? root).add(node_s_bolt_2_37);
  nodes["s-bolt-2"] = node_s_bolt_2_37;
  const mesh_s_bolt_2_37Geometry = endpoint_s_bolt_2_37
    ? new THREE.CylinderGeometry(endpoint_s_bolt_2_37.endRadius, endpoint_s_bolt_2_37.baseRadius, endpoint_s_bolt_2_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_s_bolt_2_37) {
    mesh_s_bolt_2_37Geometry.scale(0.05, 0.011, 0.004);
  }
  const mesh_s_bolt_2_37 = new THREE.Mesh(
    mesh_s_bolt_2_37Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_s_bolt_2_37.name = "S bolt bar 2";
  if (endpoint_s_bolt_2_37) {
    mesh_s_bolt_2_37.position.copy(endpoint_s_bolt_2_37.midpoint);
    mesh_s_bolt_2_37.quaternion.copy(endpoint_s_bolt_2_37.quaternion);
  }
  mesh_s_bolt_2_37.castShadow = options.castShadow ?? true;
  mesh_s_bolt_2_37.receiveShadow = options.receiveShadow ?? true;
  mesh_s_bolt_2_37.userData.sculptComponent = {"id": "s-bolt-2", "name": "S bolt bar 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bar of the stylised S bolt: box.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "foot-s", "attachment": null, "dimensions": {"width": 0.05, "height": 0.011, "depth": 0.004, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.033, 0.1], "rotation": [0, 0, 0.0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_s_bolt_2_37.add(mesh_s_bolt_2_37);
  meshes["s-bolt-2"] = mesh_s_bolt_2_37;
  colliders["s-bolt-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_s_bolt_2_37);

  const endpoint_foot_e_logo_38 = makeAttachmentEndpoint(null);
  const node_foot_e_logo_38 = new THREE.Group();
  node_foot_e_logo_38.name = "Small logo ring on right foot__pivot";
  node_foot_e_logo_38.scale.set(1, 1, 1);
  if (endpoint_foot_e_logo_38) {
    node_foot_e_logo_38.position.copy(endpoint_foot_e_logo_38.start);
    node_foot_e_logo_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_e_logo_38.position.set(0.0, 0.06, 0.1);
    node_foot_e_logo_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_e_logo_38.userData.sculptComponent = {"id": "foot-e-logo", "name": "Small logo ring on right foot", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Small ring decal on right foot face: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.2}, "parent": "foot-e", "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.06, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_e_logo_38.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}};
  (nodes["foot-e"] ?? root).add(node_foot_e_logo_38);
  nodes["foot-e-logo"] = node_foot_e_logo_38;
  const mesh_foot_e_logo_38Geometry = endpoint_foot_e_logo_38
    ? new THREE.CylinderGeometry(endpoint_foot_e_logo_38.endRadius, endpoint_foot_e_logo_38.baseRadius, endpoint_foot_e_logo_38.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.09, 12, 48);
  if (!endpoint_foot_e_logo_38) {
    mesh_foot_e_logo_38Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_foot_e_logo_38 = new THREE.Mesh(
    mesh_foot_e_logo_38Geometry,
    materialMap["logo-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_e_logo_38.name = "Small logo ring on right foot";
  if (endpoint_foot_e_logo_38) {
    mesh_foot_e_logo_38.position.copy(endpoint_foot_e_logo_38.midpoint);
    mesh_foot_e_logo_38.quaternion.copy(endpoint_foot_e_logo_38.quaternion);
  }
  mesh_foot_e_logo_38.castShadow = options.castShadow ?? true;
  mesh_foot_e_logo_38.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_e_logo_38.userData.sculptComponent = {"id": "foot-e-logo", "name": "Small logo ring on right foot", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Small ring decal on right foot face: torus.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.2}, "parent": "foot-e", "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "meters", "confidence": 0.5}, "transform": {"position": [0, 0.06, 0.1], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "logo-yellow"}}, "material": "logo-yellow", "materialLayers": ["logo-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.05, "bumpAmplitude": 0.01, "normalPattern": "very fine grain", "displacementPattern": "none", "occlusionPattern": "none (flat print)", "edgeWearPattern": "none", "notes": "printed/painted flat decal"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(233, 205, 33, 1.0)", "secondaryAlbedo": "rgba(255, 221, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7}};
  node_foot_e_logo_38.add(mesh_foot_e_logo_38);
  meshes["foot-e-logo"] = mesh_foot_e_logo_38;
  colliders["foot-e-logo"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_foot_e_logo_38);

  const endpoint_wordmark_right_39 = makeAttachmentEndpoint(null);
  const node_wordmark_right_39 = new THREE.Group();
  node_wordmark_right_39.name = "Spikeball wordmark block 0__pivot";
  node_wordmark_right_39.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_39) {
    node_wordmark_right_39.position.copy(endpoint_wordmark_right_39.start);
    node_wordmark_right_39.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_39.position.set(0.2463, 0.0, 0.4024);
    node_wordmark_right_39.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_39.userData.sculptComponent = {"id": "wordmark-right", "name": "Spikeball wordmark block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2463, 0.0, 0.4024], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wordmark-near", "type": "decal", "note": "Spikeball lettering as 8 letter blocks (stylised)"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_39.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_39);
  nodes["wordmark-right"] = node_wordmark_right_39;
  const mesh_wordmark_right_39Geometry = endpoint_wordmark_right_39
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_39.endRadius, endpoint_wordmark_right_39.baseRadius, endpoint_wordmark_right_39.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_39) {
    mesh_wordmark_right_39Geometry.scale(0.014, 0.034, 0.003);
  }
  const mesh_wordmark_right_39 = new THREE.Mesh(
    mesh_wordmark_right_39Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_39.name = "Spikeball wordmark block 0";
  if (endpoint_wordmark_right_39) {
    mesh_wordmark_right_39.position.copy(endpoint_wordmark_right_39.midpoint);
    mesh_wordmark_right_39.quaternion.copy(endpoint_wordmark_right_39.quaternion);
  }
  mesh_wordmark_right_39.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_39.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_39.userData.sculptComponent = {"id": "wordmark-right", "name": "Spikeball wordmark block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2463, 0.0, 0.4024], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wordmark-near", "type": "decal", "note": "Spikeball lettering as 8 letter blocks (stylised)"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_39.add(mesh_wordmark_right_39);
  meshes["wordmark-right"] = mesh_wordmark_right_39;
  colliders["wordmark-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_39);

  const endpoint_wordmark_right_1_40 = makeAttachmentEndpoint(null);
  const node_wordmark_right_1_40 = new THREE.Group();
  node_wordmark_right_1_40.name = "Spikeball wordmark block 1__pivot";
  node_wordmark_right_1_40.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_1_40) {
    node_wordmark_right_1_40.position.copy(endpoint_wordmark_right_1_40.start);
    node_wordmark_right_1_40.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_1_40.position.set(0.2616, 0.0, 0.3895);
    node_wordmark_right_1_40.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_1_40.userData.sculptComponent = {"id": "wordmark-right-1", "name": "Spikeball wordmark block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2616, 0.0, 0.3895], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_1_40.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_1_40);
  nodes["wordmark-right-1"] = node_wordmark_right_1_40;
  const mesh_wordmark_right_1_40Geometry = endpoint_wordmark_right_1_40
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_1_40.endRadius, endpoint_wordmark_right_1_40.baseRadius, endpoint_wordmark_right_1_40.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_1_40) {
    mesh_wordmark_right_1_40Geometry.scale(0.014, 0.024, 0.003);
  }
  const mesh_wordmark_right_1_40 = new THREE.Mesh(
    mesh_wordmark_right_1_40Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_1_40.name = "Spikeball wordmark block 1";
  if (endpoint_wordmark_right_1_40) {
    mesh_wordmark_right_1_40.position.copy(endpoint_wordmark_right_1_40.midpoint);
    mesh_wordmark_right_1_40.quaternion.copy(endpoint_wordmark_right_1_40.quaternion);
  }
  mesh_wordmark_right_1_40.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_1_40.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_1_40.userData.sculptComponent = {"id": "wordmark-right-1", "name": "Spikeball wordmark block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2616, 0.0, 0.3895], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_1_40.add(mesh_wordmark_right_1_40);
  meshes["wordmark-right-1"] = mesh_wordmark_right_1_40;
  colliders["wordmark-right-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_1_40);

  const endpoint_wordmark_right_2_41 = makeAttachmentEndpoint(null);
  const node_wordmark_right_2_41 = new THREE.Group();
  node_wordmark_right_2_41.name = "Spikeball wordmark block 2__pivot";
  node_wordmark_right_2_41.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_2_41) {
    node_wordmark_right_2_41.position.copy(endpoint_wordmark_right_2_41.start);
    node_wordmark_right_2_41.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_2_41.position.set(0.2769, 0.0, 0.3767);
    node_wordmark_right_2_41.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_2_41.userData.sculptComponent = {"id": "wordmark-right-2", "name": "Spikeball wordmark block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2769, 0.0, 0.3767], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_2_41.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_2_41);
  nodes["wordmark-right-2"] = node_wordmark_right_2_41;
  const mesh_wordmark_right_2_41Geometry = endpoint_wordmark_right_2_41
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_2_41.endRadius, endpoint_wordmark_right_2_41.baseRadius, endpoint_wordmark_right_2_41.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_2_41) {
    mesh_wordmark_right_2_41Geometry.scale(0.014, 0.03, 0.003);
  }
  const mesh_wordmark_right_2_41 = new THREE.Mesh(
    mesh_wordmark_right_2_41Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_2_41.name = "Spikeball wordmark block 2";
  if (endpoint_wordmark_right_2_41) {
    mesh_wordmark_right_2_41.position.copy(endpoint_wordmark_right_2_41.midpoint);
    mesh_wordmark_right_2_41.quaternion.copy(endpoint_wordmark_right_2_41.quaternion);
  }
  mesh_wordmark_right_2_41.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_2_41.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_2_41.userData.sculptComponent = {"id": "wordmark-right-2", "name": "Spikeball wordmark block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2769, 0.0, 0.3767], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_2_41.add(mesh_wordmark_right_2_41);
  meshes["wordmark-right-2"] = mesh_wordmark_right_2_41;
  colliders["wordmark-right-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_2_41);

  const endpoint_wordmark_right_3_42 = makeAttachmentEndpoint(null);
  const node_wordmark_right_3_42 = new THREE.Group();
  node_wordmark_right_3_42.name = "Spikeball wordmark block 3__pivot";
  node_wordmark_right_3_42.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_3_42) {
    node_wordmark_right_3_42.position.copy(endpoint_wordmark_right_3_42.start);
    node_wordmark_right_3_42.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_3_42.position.set(0.2922, 0.0, 0.3638);
    node_wordmark_right_3_42.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_3_42.userData.sculptComponent = {"id": "wordmark-right-3", "name": "Spikeball wordmark block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2922, 0.0, 0.3638], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_3_42.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_3_42);
  nodes["wordmark-right-3"] = node_wordmark_right_3_42;
  const mesh_wordmark_right_3_42Geometry = endpoint_wordmark_right_3_42
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_3_42.endRadius, endpoint_wordmark_right_3_42.baseRadius, endpoint_wordmark_right_3_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_3_42) {
    mesh_wordmark_right_3_42Geometry.scale(0.014, 0.026, 0.003);
  }
  const mesh_wordmark_right_3_42 = new THREE.Mesh(
    mesh_wordmark_right_3_42Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_3_42.name = "Spikeball wordmark block 3";
  if (endpoint_wordmark_right_3_42) {
    mesh_wordmark_right_3_42.position.copy(endpoint_wordmark_right_3_42.midpoint);
    mesh_wordmark_right_3_42.quaternion.copy(endpoint_wordmark_right_3_42.quaternion);
  }
  mesh_wordmark_right_3_42.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_3_42.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_3_42.userData.sculptComponent = {"id": "wordmark-right-3", "name": "Spikeball wordmark block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.2922, 0.0, 0.3638], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_3_42.add(mesh_wordmark_right_3_42);
  meshes["wordmark-right-3"] = mesh_wordmark_right_3_42;
  colliders["wordmark-right-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_3_42);

  const endpoint_wordmark_right_4_43 = makeAttachmentEndpoint(null);
  const node_wordmark_right_4_43 = new THREE.Group();
  node_wordmark_right_4_43.name = "Spikeball wordmark block 4__pivot";
  node_wordmark_right_4_43.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_4_43) {
    node_wordmark_right_4_43.position.copy(endpoint_wordmark_right_4_43.start);
    node_wordmark_right_4_43.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_4_43.position.set(0.3076, 0.0, 0.351);
    node_wordmark_right_4_43.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_4_43.userData.sculptComponent = {"id": "wordmark-right-4", "name": "Spikeball wordmark block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3076, 0.0, 0.351], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_4_43.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_4_43);
  nodes["wordmark-right-4"] = node_wordmark_right_4_43;
  const mesh_wordmark_right_4_43Geometry = endpoint_wordmark_right_4_43
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_4_43.endRadius, endpoint_wordmark_right_4_43.baseRadius, endpoint_wordmark_right_4_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_4_43) {
    mesh_wordmark_right_4_43Geometry.scale(0.014, 0.034, 0.003);
  }
  const mesh_wordmark_right_4_43 = new THREE.Mesh(
    mesh_wordmark_right_4_43Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_4_43.name = "Spikeball wordmark block 4";
  if (endpoint_wordmark_right_4_43) {
    mesh_wordmark_right_4_43.position.copy(endpoint_wordmark_right_4_43.midpoint);
    mesh_wordmark_right_4_43.quaternion.copy(endpoint_wordmark_right_4_43.quaternion);
  }
  mesh_wordmark_right_4_43.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_4_43.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_4_43.userData.sculptComponent = {"id": "wordmark-right-4", "name": "Spikeball wordmark block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3076, 0.0, 0.351], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_4_43.add(mesh_wordmark_right_4_43);
  meshes["wordmark-right-4"] = mesh_wordmark_right_4_43;
  colliders["wordmark-right-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_4_43);

  const endpoint_wordmark_right_5_44 = makeAttachmentEndpoint(null);
  const node_wordmark_right_5_44 = new THREE.Group();
  node_wordmark_right_5_44.name = "Spikeball wordmark block 5__pivot";
  node_wordmark_right_5_44.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_5_44) {
    node_wordmark_right_5_44.position.copy(endpoint_wordmark_right_5_44.start);
    node_wordmark_right_5_44.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_5_44.position.set(0.3229, 0.0, 0.3381);
    node_wordmark_right_5_44.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_5_44.userData.sculptComponent = {"id": "wordmark-right-5", "name": "Spikeball wordmark block 5", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3229, 0.0, 0.3381], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_5_44.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_5_44);
  nodes["wordmark-right-5"] = node_wordmark_right_5_44;
  const mesh_wordmark_right_5_44Geometry = endpoint_wordmark_right_5_44
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_5_44.endRadius, endpoint_wordmark_right_5_44.baseRadius, endpoint_wordmark_right_5_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_5_44) {
    mesh_wordmark_right_5_44Geometry.scale(0.014, 0.026, 0.003);
  }
  const mesh_wordmark_right_5_44 = new THREE.Mesh(
    mesh_wordmark_right_5_44Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_5_44.name = "Spikeball wordmark block 5";
  if (endpoint_wordmark_right_5_44) {
    mesh_wordmark_right_5_44.position.copy(endpoint_wordmark_right_5_44.midpoint);
    mesh_wordmark_right_5_44.quaternion.copy(endpoint_wordmark_right_5_44.quaternion);
  }
  mesh_wordmark_right_5_44.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_5_44.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_5_44.userData.sculptComponent = {"id": "wordmark-right-5", "name": "Spikeball wordmark block 5", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3229, 0.0, 0.3381], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_5_44.add(mesh_wordmark_right_5_44);
  meshes["wordmark-right-5"] = mesh_wordmark_right_5_44;
  colliders["wordmark-right-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_5_44);

  const endpoint_wordmark_right_6_45 = makeAttachmentEndpoint(null);
  const node_wordmark_right_6_45 = new THREE.Group();
  node_wordmark_right_6_45.name = "Spikeball wordmark block 6__pivot";
  node_wordmark_right_6_45.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_6_45) {
    node_wordmark_right_6_45.position.copy(endpoint_wordmark_right_6_45.start);
    node_wordmark_right_6_45.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_6_45.position.set(0.3382, 0.0, 0.3253);
    node_wordmark_right_6_45.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_6_45.userData.sculptComponent = {"id": "wordmark-right-6", "name": "Spikeball wordmark block 6", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3382, 0.0, 0.3253], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_6_45.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_6_45);
  nodes["wordmark-right-6"] = node_wordmark_right_6_45;
  const mesh_wordmark_right_6_45Geometry = endpoint_wordmark_right_6_45
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_6_45.endRadius, endpoint_wordmark_right_6_45.baseRadius, endpoint_wordmark_right_6_45.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_6_45) {
    mesh_wordmark_right_6_45Geometry.scale(0.014, 0.03, 0.003);
  }
  const mesh_wordmark_right_6_45 = new THREE.Mesh(
    mesh_wordmark_right_6_45Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_6_45.name = "Spikeball wordmark block 6";
  if (endpoint_wordmark_right_6_45) {
    mesh_wordmark_right_6_45.position.copy(endpoint_wordmark_right_6_45.midpoint);
    mesh_wordmark_right_6_45.quaternion.copy(endpoint_wordmark_right_6_45.quaternion);
  }
  mesh_wordmark_right_6_45.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_6_45.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_6_45.userData.sculptComponent = {"id": "wordmark-right-6", "name": "Spikeball wordmark block 6", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3382, 0.0, 0.3253], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_6_45.add(mesh_wordmark_right_6_45);
  meshes["wordmark-right-6"] = mesh_wordmark_right_6_45;
  colliders["wordmark-right-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_6_45);

  const endpoint_wordmark_right_7_46 = makeAttachmentEndpoint(null);
  const node_wordmark_right_7_46 = new THREE.Group();
  node_wordmark_right_7_46.name = "Spikeball wordmark block 7__pivot";
  node_wordmark_right_7_46.scale.set(1, 1, 1);
  if (endpoint_wordmark_right_7_46) {
    node_wordmark_right_7_46.position.copy(endpoint_wordmark_right_7_46.start);
    node_wordmark_right_7_46.rotation.set(0.0, 0.6981, 0.0);
  } else {
    node_wordmark_right_7_46.position.set(0.3535, 0.0, 0.3124);
    node_wordmark_right_7_46.rotation.set(0.0, 0.6981, 0.0);
  }
  node_wordmark_right_7_46.userData.sculptComponent = {"id": "wordmark-right-7", "name": "Spikeball wordmark block 7", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3535, 0.0, 0.3124], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_7_46.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_right_7_46);
  nodes["wordmark-right-7"] = node_wordmark_right_7_46;
  const mesh_wordmark_right_7_46Geometry = endpoint_wordmark_right_7_46
    ? new THREE.CylinderGeometry(endpoint_wordmark_right_7_46.endRadius, endpoint_wordmark_right_7_46.baseRadius, endpoint_wordmark_right_7_46.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_right_7_46) {
    mesh_wordmark_right_7_46Geometry.scale(0.014, 0.024, 0.003);
  }
  const mesh_wordmark_right_7_46 = new THREE.Mesh(
    mesh_wordmark_right_7_46Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_right_7_46.name = "Spikeball wordmark block 7";
  if (endpoint_wordmark_right_7_46) {
    mesh_wordmark_right_7_46.position.copy(endpoint_wordmark_right_7_46.midpoint);
    mesh_wordmark_right_7_46.quaternion.copy(endpoint_wordmark_right_7_46.quaternion);
  }
  mesh_wordmark_right_7_46.castShadow = options.castShadow ?? true;
  mesh_wordmark_right_7_46.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_right_7_46.userData.sculptComponent = {"id": "wordmark-right-7", "name": "Spikeball wordmark block 7", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [0.3535, 0.0, 0.3124], "rotation": [0, 0.6981, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_right_7_46.add(mesh_wordmark_right_7_46);
  meshes["wordmark-right-7"] = mesh_wordmark_right_7_46;
  colliders["wordmark-right-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_right_7_46);

  const endpoint_wordmark_left_47 = makeAttachmentEndpoint(null);
  const node_wordmark_left_47 = new THREE.Group();
  node_wordmark_left_47.name = "Spikeball wordmark block 0__pivot";
  node_wordmark_left_47.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_47) {
    node_wordmark_left_47.position.copy(endpoint_wordmark_left_47.start);
    node_wordmark_left_47.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_47.position.set(-0.439, 0.0, 0.1726);
    node_wordmark_left_47.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_47.userData.sculptComponent = {"id": "wordmark-left", "name": "Spikeball wordmark block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.439, 0.0, 0.1726], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wordmark-left", "type": "decal", "note": "Spikeball lettering as 8 letter blocks (stylised)"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_47.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_47);
  nodes["wordmark-left"] = node_wordmark_left_47;
  const mesh_wordmark_left_47Geometry = endpoint_wordmark_left_47
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_47.endRadius, endpoint_wordmark_left_47.baseRadius, endpoint_wordmark_left_47.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_47) {
    mesh_wordmark_left_47Geometry.scale(0.014, 0.034, 0.003);
  }
  const mesh_wordmark_left_47 = new THREE.Mesh(
    mesh_wordmark_left_47Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_47.name = "Spikeball wordmark block 0";
  if (endpoint_wordmark_left_47) {
    mesh_wordmark_left_47.position.copy(endpoint_wordmark_left_47.midpoint);
    mesh_wordmark_left_47.quaternion.copy(endpoint_wordmark_left_47.quaternion);
  }
  mesh_wordmark_left_47.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_47.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_47.userData.sculptComponent = {"id": "wordmark-left", "name": "Spikeball wordmark block 0", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.439, 0.0, 0.1726], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wordmark-left", "type": "decal", "note": "Spikeball lettering as 8 letter blocks (stylised)"}], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_47.add(mesh_wordmark_left_47);
  meshes["wordmark-left"] = mesh_wordmark_left_47;
  colliders["wordmark-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_47);

  const endpoint_wordmark_left_1_48 = makeAttachmentEndpoint(null);
  const node_wordmark_left_1_48 = new THREE.Group();
  node_wordmark_left_1_48.name = "Spikeball wordmark block 1__pivot";
  node_wordmark_left_1_48.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_1_48) {
    node_wordmark_left_1_48.position.copy(endpoint_wordmark_left_1_48.start);
    node_wordmark_left_1_48.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_1_48.position.set(-0.429, 0.0, 0.1899);
    node_wordmark_left_1_48.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_1_48.userData.sculptComponent = {"id": "wordmark-left-1", "name": "Spikeball wordmark block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.429, 0.0, 0.1899], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_1_48.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_1_48);
  nodes["wordmark-left-1"] = node_wordmark_left_1_48;
  const mesh_wordmark_left_1_48Geometry = endpoint_wordmark_left_1_48
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_1_48.endRadius, endpoint_wordmark_left_1_48.baseRadius, endpoint_wordmark_left_1_48.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_1_48) {
    mesh_wordmark_left_1_48Geometry.scale(0.014, 0.024, 0.003);
  }
  const mesh_wordmark_left_1_48 = new THREE.Mesh(
    mesh_wordmark_left_1_48Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_1_48.name = "Spikeball wordmark block 1";
  if (endpoint_wordmark_left_1_48) {
    mesh_wordmark_left_1_48.position.copy(endpoint_wordmark_left_1_48.midpoint);
    mesh_wordmark_left_1_48.quaternion.copy(endpoint_wordmark_left_1_48.quaternion);
  }
  mesh_wordmark_left_1_48.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_1_48.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_1_48.userData.sculptComponent = {"id": "wordmark-left-1", "name": "Spikeball wordmark block 1", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.429, 0.0, 0.1899], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_1_48.add(mesh_wordmark_left_1_48);
  meshes["wordmark-left-1"] = mesh_wordmark_left_1_48;
  colliders["wordmark-left-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_1_48);

  const endpoint_wordmark_left_2_49 = makeAttachmentEndpoint(null);
  const node_wordmark_left_2_49 = new THREE.Group();
  node_wordmark_left_2_49.name = "Spikeball wordmark block 2__pivot";
  node_wordmark_left_2_49.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_2_49) {
    node_wordmark_left_2_49.position.copy(endpoint_wordmark_left_2_49.start);
    node_wordmark_left_2_49.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_2_49.position.set(-0.419, 0.0, 0.2072);
    node_wordmark_left_2_49.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_2_49.userData.sculptComponent = {"id": "wordmark-left-2", "name": "Spikeball wordmark block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.419, 0.0, 0.2072], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_2_49.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_2_49);
  nodes["wordmark-left-2"] = node_wordmark_left_2_49;
  const mesh_wordmark_left_2_49Geometry = endpoint_wordmark_left_2_49
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_2_49.endRadius, endpoint_wordmark_left_2_49.baseRadius, endpoint_wordmark_left_2_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_2_49) {
    mesh_wordmark_left_2_49Geometry.scale(0.014, 0.03, 0.003);
  }
  const mesh_wordmark_left_2_49 = new THREE.Mesh(
    mesh_wordmark_left_2_49Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_2_49.name = "Spikeball wordmark block 2";
  if (endpoint_wordmark_left_2_49) {
    mesh_wordmark_left_2_49.position.copy(endpoint_wordmark_left_2_49.midpoint);
    mesh_wordmark_left_2_49.quaternion.copy(endpoint_wordmark_left_2_49.quaternion);
  }
  mesh_wordmark_left_2_49.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_2_49.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_2_49.userData.sculptComponent = {"id": "wordmark-left-2", "name": "Spikeball wordmark block 2", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.419, 0.0, 0.2072], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_2_49.add(mesh_wordmark_left_2_49);
  meshes["wordmark-left-2"] = mesh_wordmark_left_2_49;
  colliders["wordmark-left-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_2_49);

  const endpoint_wordmark_left_3_50 = makeAttachmentEndpoint(null);
  const node_wordmark_left_3_50 = new THREE.Group();
  node_wordmark_left_3_50.name = "Spikeball wordmark block 3__pivot";
  node_wordmark_left_3_50.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_3_50) {
    node_wordmark_left_3_50.position.copy(endpoint_wordmark_left_3_50.start);
    node_wordmark_left_3_50.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_3_50.position.set(-0.409, 0.0, 0.2245);
    node_wordmark_left_3_50.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_3_50.userData.sculptComponent = {"id": "wordmark-left-3", "name": "Spikeball wordmark block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.409, 0.0, 0.2245], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_3_50.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_3_50);
  nodes["wordmark-left-3"] = node_wordmark_left_3_50;
  const mesh_wordmark_left_3_50Geometry = endpoint_wordmark_left_3_50
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_3_50.endRadius, endpoint_wordmark_left_3_50.baseRadius, endpoint_wordmark_left_3_50.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_3_50) {
    mesh_wordmark_left_3_50Geometry.scale(0.014, 0.026, 0.003);
  }
  const mesh_wordmark_left_3_50 = new THREE.Mesh(
    mesh_wordmark_left_3_50Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_3_50.name = "Spikeball wordmark block 3";
  if (endpoint_wordmark_left_3_50) {
    mesh_wordmark_left_3_50.position.copy(endpoint_wordmark_left_3_50.midpoint);
    mesh_wordmark_left_3_50.quaternion.copy(endpoint_wordmark_left_3_50.quaternion);
  }
  mesh_wordmark_left_3_50.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_3_50.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_3_50.userData.sculptComponent = {"id": "wordmark-left-3", "name": "Spikeball wordmark block 3", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.409, 0.0, 0.2245], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_3_50.add(mesh_wordmark_left_3_50);
  meshes["wordmark-left-3"] = mesh_wordmark_left_3_50;
  colliders["wordmark-left-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_3_50);

  const endpoint_wordmark_left_4_51 = makeAttachmentEndpoint(null);
  const node_wordmark_left_4_51 = new THREE.Group();
  node_wordmark_left_4_51.name = "Spikeball wordmark block 4__pivot";
  node_wordmark_left_4_51.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_4_51) {
    node_wordmark_left_4_51.position.copy(endpoint_wordmark_left_4_51.start);
    node_wordmark_left_4_51.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_4_51.position.set(-0.399, 0.0, 0.2419);
    node_wordmark_left_4_51.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_4_51.userData.sculptComponent = {"id": "wordmark-left-4", "name": "Spikeball wordmark block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.399, 0.0, 0.2419], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_4_51.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_4_51);
  nodes["wordmark-left-4"] = node_wordmark_left_4_51;
  const mesh_wordmark_left_4_51Geometry = endpoint_wordmark_left_4_51
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_4_51.endRadius, endpoint_wordmark_left_4_51.baseRadius, endpoint_wordmark_left_4_51.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_4_51) {
    mesh_wordmark_left_4_51Geometry.scale(0.014, 0.034, 0.003);
  }
  const mesh_wordmark_left_4_51 = new THREE.Mesh(
    mesh_wordmark_left_4_51Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_4_51.name = "Spikeball wordmark block 4";
  if (endpoint_wordmark_left_4_51) {
    mesh_wordmark_left_4_51.position.copy(endpoint_wordmark_left_4_51.midpoint);
    mesh_wordmark_left_4_51.quaternion.copy(endpoint_wordmark_left_4_51.quaternion);
  }
  mesh_wordmark_left_4_51.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_4_51.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_4_51.userData.sculptComponent = {"id": "wordmark-left-4", "name": "Spikeball wordmark block 4", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.034, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.399, 0.0, 0.2419], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_4_51.add(mesh_wordmark_left_4_51);
  meshes["wordmark-left-4"] = mesh_wordmark_left_4_51;
  colliders["wordmark-left-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_4_51);

  const endpoint_wordmark_left_5_52 = makeAttachmentEndpoint(null);
  const node_wordmark_left_5_52 = new THREE.Group();
  node_wordmark_left_5_52.name = "Spikeball wordmark block 5__pivot";
  node_wordmark_left_5_52.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_5_52) {
    node_wordmark_left_5_52.position.copy(endpoint_wordmark_left_5_52.start);
    node_wordmark_left_5_52.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_5_52.position.set(-0.389, 0.0, 0.2592);
    node_wordmark_left_5_52.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_5_52.userData.sculptComponent = {"id": "wordmark-left-5", "name": "Spikeball wordmark block 5", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.389, 0.0, 0.2592], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_5_52.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_5_52);
  nodes["wordmark-left-5"] = node_wordmark_left_5_52;
  const mesh_wordmark_left_5_52Geometry = endpoint_wordmark_left_5_52
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_5_52.endRadius, endpoint_wordmark_left_5_52.baseRadius, endpoint_wordmark_left_5_52.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_5_52) {
    mesh_wordmark_left_5_52Geometry.scale(0.014, 0.026, 0.003);
  }
  const mesh_wordmark_left_5_52 = new THREE.Mesh(
    mesh_wordmark_left_5_52Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_5_52.name = "Spikeball wordmark block 5";
  if (endpoint_wordmark_left_5_52) {
    mesh_wordmark_left_5_52.position.copy(endpoint_wordmark_left_5_52.midpoint);
    mesh_wordmark_left_5_52.quaternion.copy(endpoint_wordmark_left_5_52.quaternion);
  }
  mesh_wordmark_left_5_52.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_5_52.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_5_52.userData.sculptComponent = {"id": "wordmark-left-5", "name": "Spikeball wordmark block 5", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.026, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.389, 0.0, 0.2592], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_5_52.add(mesh_wordmark_left_5_52);
  meshes["wordmark-left-5"] = mesh_wordmark_left_5_52;
  colliders["wordmark-left-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_5_52);

  const endpoint_wordmark_left_6_53 = makeAttachmentEndpoint(null);
  const node_wordmark_left_6_53 = new THREE.Group();
  node_wordmark_left_6_53.name = "Spikeball wordmark block 6__pivot";
  node_wordmark_left_6_53.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_6_53) {
    node_wordmark_left_6_53.position.copy(endpoint_wordmark_left_6_53.start);
    node_wordmark_left_6_53.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_6_53.position.set(-0.379, 0.0, 0.2765);
    node_wordmark_left_6_53.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_6_53.userData.sculptComponent = {"id": "wordmark-left-6", "name": "Spikeball wordmark block 6", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.379, 0.0, 0.2765], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_6_53.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_6_53);
  nodes["wordmark-left-6"] = node_wordmark_left_6_53;
  const mesh_wordmark_left_6_53Geometry = endpoint_wordmark_left_6_53
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_6_53.endRadius, endpoint_wordmark_left_6_53.baseRadius, endpoint_wordmark_left_6_53.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_6_53) {
    mesh_wordmark_left_6_53Geometry.scale(0.014, 0.03, 0.003);
  }
  const mesh_wordmark_left_6_53 = new THREE.Mesh(
    mesh_wordmark_left_6_53Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_6_53.name = "Spikeball wordmark block 6";
  if (endpoint_wordmark_left_6_53) {
    mesh_wordmark_left_6_53.position.copy(endpoint_wordmark_left_6_53.midpoint);
    mesh_wordmark_left_6_53.quaternion.copy(endpoint_wordmark_left_6_53.quaternion);
  }
  mesh_wordmark_left_6_53.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_6_53.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_6_53.userData.sculptComponent = {"id": "wordmark-left-6", "name": "Spikeball wordmark block 6", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.03, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.379, 0.0, 0.2765], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_6_53.add(mesh_wordmark_left_6_53);
  meshes["wordmark-left-6"] = mesh_wordmark_left_6_53;
  colliders["wordmark-left-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_6_53);

  const endpoint_wordmark_left_7_54 = makeAttachmentEndpoint(null);
  const node_wordmark_left_7_54 = new THREE.Group();
  node_wordmark_left_7_54.name = "Spikeball wordmark block 7__pivot";
  node_wordmark_left_7_54.scale.set(1, 1, 1);
  if (endpoint_wordmark_left_7_54) {
    node_wordmark_left_7_54.position.copy(endpoint_wordmark_left_7_54.start);
    node_wordmark_left_7_54.rotation.set(0.0, -1.0472, 0.0);
  } else {
    node_wordmark_left_7_54.position.set(-0.369, 0.0, 0.2938);
    node_wordmark_left_7_54.rotation.set(0.0, -1.0472, 0.0);
  }
  node_wordmark_left_7_54.userData.sculptComponent = {"id": "wordmark-left-7", "name": "Spikeball wordmark block 7", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.369, 0.0, 0.2938], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_7_54.userData.actionProfile = {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}};
  (nodes["rim-band"] ?? root).add(node_wordmark_left_7_54);
  nodes["wordmark-left-7"] = node_wordmark_left_7_54;
  const mesh_wordmark_left_7_54Geometry = endpoint_wordmark_left_7_54
    ? new THREE.CylinderGeometry(endpoint_wordmark_left_7_54.endRadius, endpoint_wordmark_left_7_54.baseRadius, endpoint_wordmark_left_7_54.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_wordmark_left_7_54) {
    mesh_wordmark_left_7_54Geometry.scale(0.014, 0.024, 0.003);
  }
  const mesh_wordmark_left_7_54 = new THREE.Mesh(
    mesh_wordmark_left_7_54Geometry,
    materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wordmark_left_7_54.name = "Spikeball wordmark block 7";
  if (endpoint_wordmark_left_7_54) {
    mesh_wordmark_left_7_54.position.copy(endpoint_wordmark_left_7_54.midpoint);
    mesh_wordmark_left_7_54.quaternion.copy(endpoint_wordmark_left_7_54.quaternion);
  }
  mesh_wordmark_left_7_54.castShadow = options.castShadow ?? true;
  mesh_wordmark_left_7_54.receiveShadow = options.receiveShadow ?? true;
  mesh_wordmark_left_7_54.userData.sculptComponent = {"id": "wordmark-left-7", "name": "Spikeball wordmark block 7", "level": "micro", "role": "decal", "importance": 1.0, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Black print block on yellow rim.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rim-band", "attachment": null, "dimensions": {"width": 0.014, "height": 0.024, "depth": 0.003, "units": "meters", "confidence": 0.5}, "transform": {"position": [-0.369, 0.0, 0.2938], "rotation": [0, -1.0472, 0]}, "actionProfile": {"animationRole": "decal", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "decals", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "net-black"}}, "material": "net-black", "materialLayers": ["net-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.85, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat (cord twist below render scale)", "displacementPattern": "none", "occlusionPattern": "none", "edgeWearPattern": "none", "notes": "matte nylon cord, flat maps"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 17, 17, 1.0)", "secondaryAlbedo": "rgba(30, 30, 30, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.7}};
  node_wordmark_left_7_54.add(mesh_wordmark_left_7_54);
  meshes["wordmark-left-7"] = mesh_wordmark_left_7_54;
  colliders["wordmark-left-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.02, 0.02, 0.01], "isTrigger": false, "notes": "ball-contact surface proxy"};
  destructionGroups["decals"] ??= [];
  destructionGroups["decals"].push(node_wordmark_left_7_54);

  // repetition system: net-radial-cords (InstancedMesh, radial, count=36, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.43, 0.004, 0.004];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.43;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 36);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 36; i++) {
      const ang = ((0.0) + (i * 360) / 36) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "net-radial-cords";
    parent.add(cluster);
  }

  // repetition system: rim-wrap-cords (InstancedMesh, radial, count=64, level=micro)
  {
    const parent = nodes["rim-band"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["net-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.006, 0.125, 0.003];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.935;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 64);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 64; i++) {
      const ang = ((0.0) + (i * 360) / 64) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rim-wrap-cords";
    parent.add(cluster);
  }

  // repetition system: bracket-screws (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-mount"] ?? root;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
    const mat = materialMap["rim-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.012, 0.012, 0.012];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.8;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "bracket-screws";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createSpikeballTitanRoundnetLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Spikeball Titan Roundnet look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "note": "soft key from upper front-left, intensity 2.2, warm white; studio product shot"}, {"id": "fill", "type": "hemisphere", "note": "neutral sky fill 0.8 so black plastic keeps readable sheen"}, {"id": "rim", "type": "directional", "note": "weak back rim light from upper right, intensity 0.9"}, {"id": "tone", "type": "renderer", "note": "ACESFilmic tone mapping, exposure 1.0; white background"}, {"id": "shadow", "type": "ground", "note": "soft contact shadow / ground shadow under the feet (ambient occlusion)"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createSpikeballTitanRoundnetEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameSpikeballTitanRoundnetCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createSpikeballTitanRoundnetPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureSpikeballTitanRoundnetRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createSpikeballTitanRoundnetInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
