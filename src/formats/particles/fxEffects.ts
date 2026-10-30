import type { SageToken } from '../ini/sageIniParser';
import type { Range, Vec3 } from './particleIni';

/**
 * Preview of the FX list nuggets other than `ParticleSystem` and `Sound`. mint fires
 * only particle nuggets and records the rest in its FX tree as inert rows;
 * the preview does the same for what it cannot show and approximates the
 * three it can: `LightPulse` as a screen flash, `ViewShake` and
 * `CameraShakerVolume` as a camera shake, `TerrainScorch` as a ring on the
 * ground. The shapes are the previewer's own: the games' strengths and
 * falloffs are not read from their data, so these show when and roughly how
 * big, not how it looks in game.
 */

/** Shape the preview draws for a nugget it can approximate */
export type FxApproximation =
  | {
      type: 'shake';
      /** Seconds the shake lasts */
      seconds: number;
      /** Peak swing of the camera in degrees */
      degrees: number;
    }
  | {
      type: 'flash';
      /** 0..1 per channel */
      color: Vec3;
      /** Milliseconds to the peak */
      rise: number;
      /** Milliseconds from the peak back down */
      fall: number;
    }
  | { type: 'scorch'; radius: number };

/** One nugget the preview lists on the timeline rather than plays */
export interface FxEffect {
  /** The nugget's keyword as written: `LightPulse`, `FXListAtBonePos` */
  slot: string;
  /** Which of the FX list's modules it is */
  module: number;
  /** Milliseconds, as `Sound` reads it */
  initialDelay: Range;
  /** The nugget's own fields worth showing, as `Name value` text */
  detail: string;
  /** Absent when the preview only lists the nugget */
  approximation?: FxApproximation;
}

/** One field line of a nugget: lowercased key and its value tokens */
type Fields = Map<string, SageToken[]>;

/** Reads a number token, NaN when it is not one: `parseIniNumber` of the reader */
type ParseNumber = (text: string) => number;

const numberAt = (
  fields: Fields,
  key: string,
  fallback: number,
  parse: ParseNumber,
): number => {
  const number = parse(fields.get(key)?.[0]?.text ?? '');

  return isNaN(number) ? fallback : number;
};

const textAt = (fields: Fields, key: string): string | undefined =>
  fields.get(key)?.[0]?.text;

/** Reads `R:255 G:128 B:0` as 0..1 channels; white when absent or unreadable */
const colorAt = (fields: Fields, key: string, parse: ParseNumber): Vec3 => {
  const values = fields.get(key) ?? [];
  const channels = values.slice(0, 3).map((value) => parse(value.text));

  return channels.length === 3 && channels.every((value) => !isNaN(value))
    ? (channels.map((value) => Math.min(1, Math.max(0, value / 255))) as Vec3)
    : [1, 1, 1];
};

/** Degrees of swing for `ViewShake`'s named strengths; this scale is the preview's */
const SHAKE_DEGREES: Record<string, number> = {
  subtle: 0.3,
  normal: 0.8,
  strong: 1.6,
  severe: 3,
  cine_extreme: 5,
  cine_insane: 8,
};

const SHAKE_SECONDS = 0.6;
const DEFAULT_SCORCH_RADIUS = 20;

/** Names and shows the fields of a nugget that say what it does */
const describe = (fields: Fields, keys: string[]): string =>
  keys
    .flatMap((key) => {
      const values = fields.get(key.toLowerCase());

      return values?.length
        ? [`${key} ${values.map((value) => value.text).join(' ')}`]
        : [];
    })
    .join(', ');

/** The fields each known nugget kind is described by, in the order shown */
const DETAIL_KEYS: Record<string, string[]> = {
  fxlistatbonepos: ['FX', 'BoneName'],
  buffnugget: ['BuffType', 'BuffThingTemplate', 'BuffLifeTime'],
  attachedmodel: ['Modelname', 'ExpireTimer'],
  model: ['Modelname', 'ExpireTimer'],
  tracer: ['Length', 'Width', 'Speed'],
  tracerfx: ['Length', 'Width', 'Speed'],
  dynamicdecal: ['DecalName', 'Size', 'Lifetime'],
  tintdrawable: ['Color', 'Frequency'],
  evaevent: ['Name'],
  lightpulse: ['Color', 'Radius', 'IncreaseTime', 'DecreaseTime'],
  terrainscorch: ['Type', 'Radius'],
  viewshake: ['Type'],
  camerashakervolume: ['Radius', 'Duration_Seconds', 'Amplitude_Degrees'],
};

/**
 * Reads one nugget that is neither a particle system nor a sound. `fields`
 * are the nugget's own lines, lowercased and last write winning.
 */
export const readFxEffect = (
  slot: string,
  module: number,
  fields: Fields,
  initialDelay: Range,
  parse: ParseNumber,
): FxEffect => {
  const kind = slot.toLowerCase();
  const detail = describe(fields, DETAIL_KEYS[kind] ?? []);
  const base = { slot, module, initialDelay, detail };

  if (kind === 'viewshake') {
    const type = (textAt(fields, 'type') ?? 'normal').toLowerCase();

    return {
      ...base,
      approximation: {
        type: 'shake',
        seconds: SHAKE_SECONDS,
        degrees: SHAKE_DEGREES[type] ?? SHAKE_DEGREES.normal,
      },
    };
  }
  if (kind === 'camerashakervolume') {
    return {
      ...base,
      approximation: {
        type: 'shake',
        seconds: Math.max(0, numberAt(fields, 'duration_seconds', 1, parse)),
        degrees: Math.max(0, numberAt(fields, 'amplitude_degrees', 1, parse)),
      },
    };
  }
  if (kind === 'lightpulse') {
    const rise = Math.max(0, numberAt(fields, 'increasetime', 0, parse));
    const fall = Math.max(0, numberAt(fields, 'decreasetime', 0, parse));

    return {
      ...base,
      approximation: {
        type: 'flash',
        color: colorAt(fields, 'color', parse),
        // A pulse that writes no times still has to be seen
        rise,
        fall: rise + fall === 0 ? 300 : fall,
      },
    };
  }
  if (kind === 'terrainscorch') {
    return {
      ...base,
      approximation: {
        type: 'scorch',
        radius: Math.max(
          1,
          numberAt(fields, 'radius', DEFAULT_SCORCH_RADIUS, parse),
        ),
      },
    };
  }
  return base;
};

/** Contribution of the approximated nuggets to the picture at one moment */
export interface FxEffectState {
  /** Degrees to swing the camera by, signed */
  shake: number;
  /** The strongest flash right now, if any */
  flash?: { color: Vec3; alpha: number };
  /** Radii of the scorches that have appeared by now */
  scorches: number[];
}

/** The most opaque a flash gets, so the effect behind it stays readable */
const FLASH_PEAK = 0.45;

/**
 * Computes what the approximated nuggets add at a simulation frame. Deterministic: the shake
 * is a fixed wobble scaled by a falloff, so a paused or stepped preview
 * shows the same picture each time.
 */
export const effectsAt = (
  effects: readonly FxEffect[],
  frame: number,
  hz: number,
): FxEffectState => {
  const now = (frame / hz) * 1000;
  const state: FxEffectState = { shake: 0, scorches: [] };

  for (const effect of effects) {
    const approximation = effect.approximation;
    const elapsed = now - effect.initialDelay.low;

    if (!approximation || elapsed < 0) {
      continue;
    }
    if (approximation.type === 'shake') {
      const length = approximation.seconds * 1000;

      if (elapsed < length) {
        const falloff = 1 - elapsed / length;

        state.shake +=
          approximation.degrees * falloff * Math.sin(elapsed * 0.045);
      }
    } else if (approximation.type === 'flash') {
      const { rise, fall } = approximation;
      const alpha =
        elapsed < rise
          ? elapsed / rise
          : elapsed < rise + fall
            ? 1 - (elapsed - rise) / fall
            : 0;

      if (alpha > 0 && alpha * FLASH_PEAK > (state.flash?.alpha ?? 0)) {
        state.flash = { color: approximation.color, alpha: alpha * FLASH_PEAK };
      }
    } else {
      state.scorches.push(approximation.radius);
    }
  }
  return state;
};

/** Gets the milliseconds an approximated nugget is visibly doing something; zero for a scorch, which stays */
export const effectLength = (effect: FxEffect): number => {
  const approximation = effect.approximation;

  return approximation?.type === 'shake'
    ? approximation.seconds * 1000
    : approximation?.type === 'flash'
      ? approximation.rise + approximation.fall
      : 0;
};
