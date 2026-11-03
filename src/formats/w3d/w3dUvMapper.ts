/**
 * UV mappers: how a texture stage's coordinates move or are generated.
 * `VERTEX_MATERIAL_INFO` names a mapper a stage and `VERTEX_MAPPER_ARGS` holds
 * its arguments as `Key=Value` lines. Ported from mint's `uv_mapper.rs` and
 * `MapperArgs::parse`, with `SCALE` added: its two arguments can only mean the
 * tiling `LINEAR_OFFSET` applies with the same keys.
 */

/** The `W3DVERTMAT_STAGE*_MAPPING_*` values a stage can name, as `w3d_file.h` numbers them */
export const UV_MAPPER = {
  UV: 0x00,
  ENVIRONMENT: 0x01,
  CHEAP_ENVIRONMENT: 0x02,
  LINEAR_OFFSET: 0x04,
  SCALE: 0x06,
  GRID: 0x07,
  ROTATE: 0x08,
  SINE_LINEAR_OFFSET: 0x09,
  WS_CLASSIC_ENVIRONMENT: 0x0c,
  WS_ENVIRONMENT: 0x0d,
  BUMP_ENVIRONMENT: 0x12,
} as const;

/** One texture stage's mapper and its arguments */
export interface W3dUvMapper {
  /** A `UV_MAPPER` value, or another the file names, which draws as `UV` */
  type: number;
  uPerSecond: number;
  vPerSecond: number;
  uScale: number;
  vScale: number;
  /** `ROTATE`'s turns a second */
  speed: number;
  uCenter: number;
  vCenter: number;
  uAmplitude: number;
  uFrequency: number;
  uPhase: number;
  vAmplitude: number;
  vFrequency: number;
  vPhase: number;
  /** `GRID`'s cells a second; negative runs the sheet backwards, zero holds it */
  fps: number;
  log2Width: number;
  /** `GRID`'s cell count; zero means the whole sheet */
  last: number;
  /** `GRID`'s starting cell */
  offset: number;
  bumpRotation: number;
  bumpScale: number;
}

/** A 2D affine transform of texture coordinates: `u' = a*u + b*v + x`, `v' = c*u + d*v + y` */
export interface UvTransform {
  linear: [a: number, b: number, c: number, d: number];
  offset: [x: number, y: number];
}

/** The transform that leaves coordinates alone */
export const IDENTITY_UV_TRANSFORM: UvTransform = {
  linear: [1, 0, 0, 1],
  offset: [0, 0],
};

const DEFAULT_MAPPER: W3dUvMapper = {
  type: UV_MAPPER.UV,
  uPerSecond: 0,
  vPerSecond: 0,
  uScale: 1,
  vScale: 1,
  speed: 0.1,
  uCenter: 0,
  vCenter: 0,
  uAmplitude: 1,
  uFrequency: 1,
  uPhase: 0,
  vAmplitude: 1,
  vFrequency: 1,
  vPhase: 0,
  fps: 1,
  log2Width: 1,
  last: 0,
  offset: 0,
  bumpRotation: 0,
  bumpScale: 1,
};

/** The stored spellings of each argument, including the typos the shipped files make */
const ARGUMENT_KEYS: Record<string, keyof W3dUvMapper> = {
  UPerSec: "uPerSecond",
  UperSec: "uPerSecond",
  VPerSec: "vPerSecond",
  VPreSec: "vPerSecond",
  UScale: "uScale",
  VScale: "vScale",
  Speed: "speed",
  UCenter: "uCenter",
  VCenter: "vCenter",
  UAmp: "uAmplitude",
  UFreq: "uFrequency",
  UPhase: "uPhase",
  VAmp: "vAmplitude",
  VFreq: "vFrequency",
  VPhase: "vPhase",
  FPS: "fps",
  Log2Width: "log2Width",
  Last: "last",
  Offset: "offset",
  BumpRotation: "bumpRotation",
  BumpScale: "bumpScale",
};

/** The largest `Log2Width` honoured: the value is an untrusted shift, and retail stops at 4 */
const MAX_GRID_LOG2_WIDTH = 8;

/** Reads a number the way the shipped text spells it, tolerating `0.3f` and `0.3..0` */
const parseArgument = (text: string): number | undefined => {
  const value = Number.parseFloat(text.replace(/[fF]+$/, "").replace("..", "."));

  return Number.isFinite(value) ? value : undefined;
};

/** Reads a stage's mapper from its number and its argument text; what does not parse keeps its default */
export const parseUvMapper = (type: number, text = ""): W3dUvMapper => {
  const mapper = { ...DEFAULT_MAPPER, type };

  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    const key = ARGUMENT_KEYS[line.slice(0, Math.max(at, 0)).trim()];
    const value = parseArgument(line.slice(at + 1).split(";")[0].trim());

    if (at >= 0 && key && key !== "type" && value !== undefined) {
      mapper[key] = value;
    }
  }

  return mapper;
};

const TURN = Math.PI * 2;
/** Keeps an offset small over a long session; a repeating texture does not see the difference */
const wrap = (value: number) => value - Math.floor(value);

/** Finds the cell of a `last`-cell sheet showing at `seconds`, stepping whole milliseconds as EA does */
const findGridFrame = (fps: number, seconds: number, origin: number, last: number) => {
  if (fps === 0) {
    return origin;
  }

  const period = Math.max(1, Math.floor(1000 / Math.abs(fps)));
  const steps = Math.floor(Math.floor(seconds * 1000) / period);
  const frame = (origin + (fps < 0 ? -steps : steps)) % last;

  return frame < 0 ? frame + last : frame;
};

const sampleGrid = (mapper: W3dUvMapper, seconds: number): UvTransform => {
  const log2 = Math.min(Math.max(0, Math.floor(mapper.log2Width)), MAX_GRID_LOG2_WIDTH);
  const width = 1 << log2;
  const last = Math.floor(mapper.last) > 0 ? Math.floor(mapper.last) : width * width;
  const start = Math.max(0, Math.floor(mapper.offset)) % last;
  const origin = mapper.fps < 0 ? last - 1 - start : start;
  const frame = findGridFrame(mapper.fps, seconds, origin, last);

  return {
    linear: IDENTITY_UV_TRANSFORM.linear,
    offset: [(frame % width) / width, Math.floor(frame / width) % width / width],
  };
};

const sampleRotate = (mapper: W3dUvMapper, seconds: number): UvTransform => {
  // Speed is how the visible image turns, and this moves the sample point
  const angle = -TURN * mapper.speed * seconds;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const { uScale, vScale, uCenter, vCenter } = mapper;
  const linear: UvTransform["linear"] = [uScale * cos, -uScale * sin, vScale * sin, vScale * cos];

  return {
    linear,
    offset: [
      uCenter - (linear[0] * uCenter + linear[1] * vCenter),
      vCenter - (linear[2] * uCenter + linear[3] * vCenter),
    ],
  };
};

/**
 * Samples a stage's transform at `seconds` on the preview's clock. A mapper
 * this does not animate is the identity, and an environment mapper's
 * coordinates are generated by the vertex shader instead.
 */
export const sampleUvTransform = (mapper: W3dUvMapper, seconds: number): UvTransform => {
  switch (mapper.type) {
    case UV_MAPPER.LINEAR_OFFSET:
    case UV_MAPPER.BUMP_ENVIRONMENT:
      return {
        linear: [mapper.uScale, 0, 0, mapper.vScale],
        // The arguments say how the image moves, and this moves the sample point
        offset: [wrap(-mapper.uPerSecond * seconds), wrap(-mapper.vPerSecond * seconds)],
      };
    case UV_MAPPER.SCALE:
      return { linear: [mapper.uScale, 0, 0, mapper.vScale], offset: [0, 0] };
    case UV_MAPPER.ROTATE:
      return sampleRotate(mapper, seconds);
    case UV_MAPPER.SINE_LINEAR_OFFSET:
      return {
        linear: IDENTITY_UV_TRANSFORM.linear,
        offset: [
          mapper.uAmplitude * Math.sin(TURN * mapper.uFrequency * seconds + mapper.uPhase),
          mapper.vAmplitude * Math.sin(TURN * mapper.vFrequency * seconds + mapper.vPhase),
        ],
      };
    case UV_MAPPER.GRID:
      return sampleGrid(mapper, seconds);
    default:
      return IDENTITY_UV_TRANSFORM;
  }
};

/**
 * Samples the matrix a bump stage applies to its `(du, dv)` before moving the
 * next stage's coordinate: the identity unless the stage's mapper turns it.
 * @returns `[m00, m01, m10, m11]`, an offset being `du * (m00, m01) + dv * (m10, m11)`
 */
export const sampleBumpMatrix = (
  mapper: W3dUvMapper,
  seconds: number,
): [number, number, number, number] => {
  if (mapper.type !== UV_MAPPER.BUMP_ENVIRONMENT) {
    return [1, 0, 0, 1];
  }

  const angle = TURN * mapper.bumpRotation * seconds;
  const cos = mapper.bumpScale * Math.cos(angle);
  const sin = mapper.bumpScale * Math.sin(angle);

  return [cos, -sin, sin, cos];
};

/** Whether a mapper changes with the clock */
export const isUvMapperAnimated = (mapper: W3dUvMapper): boolean => {
  switch (mapper.type) {
    case UV_MAPPER.LINEAR_OFFSET:
      return mapper.uPerSecond !== 0 || mapper.vPerSecond !== 0;
    case UV_MAPPER.BUMP_ENVIRONMENT:
      return mapper.uPerSecond !== 0 || mapper.vPerSecond !== 0 || mapper.bumpRotation !== 0;
    case UV_MAPPER.ROTATE:
      return mapper.speed !== 0;
    case UV_MAPPER.GRID:
      return mapper.fps !== 0;
    case UV_MAPPER.SINE_LINEAR_OFFSET:
      return true;
    default:
      return false;
  }
};
