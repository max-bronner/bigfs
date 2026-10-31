/** Three-component vector: a position, offset or velocity in world units, or an RGB colour */
export type Vec3 = [number, number, number];

/** A low/high pair rolled once per particle or per burst; not sorted */
export interface Range {
  low: number;
  high: number;
}

/** Emission volume new particles start inside, by module type */
export type Volume =
  | { type: 'point' }
  | { type: 'line'; start: Vec3; end: Vec3 }
  | { type: 'box'; halfSize: Vec3; hollow: boolean }
  | { type: 'sphere'; radius: number; hollow: boolean }
  | {
      type: 'cylinder';
      radius: number;
      length: number;
      offset: Vec3;
      hollow: boolean;
    }
  /** A module the preview does not emit from, drawn as a point */
  | { type: 'unread'; module: string };

/** Emission velocity new particles start with, by module type; speeds are per frame */
export type Velocity =
  | { type: 'ortho'; x: Range; y: Range; z: Range }
  | { type: 'spherical'; speed: Range }
  | { type: 'hemispherical'; speed: Range }
  | { type: 'cylindrical'; radial: Range; normal: Range }
  | { type: 'outward'; speed: Range; otherSpeed: Range };

/** Colour key of a particle's lifetime curve */
export interface ColorKey {
  /** 0..1 per channel */
  rgb: Vec3;
  frame: number;
}

/** Alpha key of a particle's lifetime curve, rolled within its range */
export interface AlphaKey {
  value: Range;
  frame: number;
}

/** Wind settings of a particle system's `Wind` module */
export interface Wind {
  motion: 'none' | 'pingpong' | 'circular';
  strength: number;
  fullStrengthDist: number;
  zeroStrengthDist: number;
  angleChange: Range;
  start: Range;
  end: Range;
}

/** Particle system read into plain data a preview can simulate, with the games' defaults filled in */
export interface ParticleDef {
  name: string;
  form: 'block' | 'flat';
  particleName?: string;
  /** `Shader`; absent reads as `ADDITIVE` */
  shader: string;
  /** `Type`, `PARTICLE` when absent */
  type: string;
  drawModule?: string;
  priority?: string;
  lifetime: Range;
  /** Frames; 0 means forever */
  systemLifetime: number;
  initialDelay: Range;
  burstCount: Range;
  burstDelay: Range;
  size: Range;
  startSizeRate: Range;
  oneShot: boolean;
  groundAligned: boolean;
  upTowardsEmitter: boolean;
  volume: Volume;
  velocity: Velocity;
  gravity: number;
  drift: Vec3;
  /** Defaults to 0: an unwritten damping holds a particle to its drift */
  velocityDamping: Range;
  attachToBone: boolean;
  sizeRate: Range;
  sizeRateDamping: Range;
  angleZ: Range;
  angularRateZ: Range;
  angularDamping: Range;
  colors: ColorKey[];
  alphas: AlphaKey[];
  hasAlphaBlock: boolean;
  /** In 1/255 units, rolled per particle onto `Color2`..`Color7` */
  colorScale: Range;
  flipbook?: { totalFrames: number; framesPerRow: number; speed: number };
  slaveSystem?: string;
  slavePosOffset: Vec3;
  perParticleSystem?: string;
  event?: { fx?: string; heightOffset: number; killAfterEvent: boolean };
  wind?: Wind;
}
