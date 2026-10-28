import { stripComment, tokenize } from '../../language/model/sageIniParser';
import { readFxEffect } from './fxEffects';
import type { FxEffect } from './fxEffects';
import type { SageToken } from '../../language/model/sageIniParser';

/**
 * Reads particle systems and FX lists out of INI text into plain data a
 * preview can simulate: `FXParticleSystem` (BFME's block form, module slots),
 * `ParticleSystem` (Generals' flat form) and `FXList` with its
 * `ParticleSystem` nuggets. Field names, defaults and units follow the
 * games' own parse tables as mint's research records them: every time is in
 * 30 Hz frames except a nugget's `InitialDelay`, which is milliseconds.
 */

export type Vec3 = [number, number, number];

/** A low/high pair rolled once per particle or per burst; not sorted */
export interface Range {
  low: number;
  high: number;
}

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

export type Velocity =
  | { type: 'ortho'; x: Range; y: Range; z: Range }
  | { type: 'spherical'; speed: Range }
  | { type: 'hemispherical'; speed: Range }
  | { type: 'cylindrical'; radial: Range; normal: Range }
  | { type: 'outward'; speed: Range; otherSpeed: Range };

export interface ColorKey {
  /** 0..1 per channel */
  rgb: Vec3;
  frame: number;
}

export interface AlphaKey {
  value: Range;
  frame: number;
}

export interface Wind {
  motion: 'none' | 'pingpong' | 'circular';
  strength: number;
  fullStrengthDist: number;
  zeroStrengthDist: number;
  angleChange: Range;
  start: Range;
  end: Range;
}

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

export interface FxNugget {
  system: string;
  /** Which of the FX list's modules it is */
  module: number;
  count: number;
  offset: Vec3;
  radius: Range;
  height: Range;
  /** Milliseconds */
  initialDelay: Range;
}

/** A `Sound` nugget: an audio event the preview plays only when asked to */
export interface FxSound {
  /** The audio event's name */
  name: string;
  /** Which of the FX list's modules it is */
  module: number;
  /** Milliseconds; zero when the nugget writes none */
  initialDelay: Range;
}

export interface FxListDef {
  name: string;
  nuggets: FxNugget[];
  sounds: FxSound[];
  /** Every other nugget kind, in file order: approximated or only listed */
  effects: FxEffect[];
}

/** One line of a block: its keyword and values, with columns */
export interface IniLine {
  line: number;
  keyword: SageToken;
  values: SageToken[];
  /** The module slot a line sits in, empty at the definition's own level */
  module: string;
  /** The module type the slot names, `System` for the bare `System` slot */
  moduleType: string;
  /** Which of the definition's modules it sits in, -1 for none */
  moduleIndex: number;
}

/** A module block: its slot, the type it names and where it opens */
export interface IniModule {
  slot: string;
  type: string;
  line: number;
}

/** A definition found in text, with its fields in order */
export interface IniDefinition {
  keyword: string;
  name: string;
  startLine: number;
  endLine: number;
  lines: IniLine[];
  modules: IniModule[];
}

const SLOTS = new Set(
  [
    'System',
    'EmissionVelocity',
    'EmissionVolume',
    'Color',
    'Update',
    'Draw',
    'Physics',
    'Alpha',
    'Wind',
    'Event',
    'Emitter',
  ].map((slot) => slot.toLowerCase()),
);

export const DEFINITION_KEYWORDS = [
  'FXParticleSystem',
  'ParticleSystem',
  'FXList',
] as const;

const isEnd = (word: string) => /^end$/i.test(word);

/**
 * Every particle system and FX list defined at file scope in `text`. A
 * module opens on a slot keyword (block form) or on any bare word (an FX
 * list's nuggets); everything else is a field.
 */
export const findParticleDefinitions = (text: string): IniDefinition[] => {
  const lines = text.split(/\r?\n/);
  const found: IniDefinition[] = [];
  let open: IniDefinition | undefined;
  let module: { slot: string; type: string } | undefined;

  lines.forEach((raw, line) => {
    const tokens = tokenize(stripComment(raw));
    const [keyword, ...values] = tokens;

    if (!keyword) {
      return;
    }

    if (!open) {
      const kind = DEFINITION_KEYWORDS.find(
        (candidate) => candidate.toLowerCase() === keyword.text.toLowerCase(),
      );

      if (kind && values[0]) {
        open = {
          keyword: kind,
          name: values[0].text,
          startLine: line,
          endLine: line,
          lines: [],
          modules: [],
        };
      }
      return;
    }

    if (isEnd(keyword.text)) {
      if (module) {
        module = undefined;
      } else {
        open.endLine = line;
        found.push(open);
        open = undefined;
      }
      return;
    }

    const hasEquals = /=/.test(stripComment(raw));
    const opensModule =
      !module &&
      (open.keyword === 'FXParticleSystem'
        ? SLOTS.has(keyword.text.toLowerCase())
        : open.keyword === 'FXList' && !hasEquals);

    if (opensModule) {
      module = { slot: keyword.text, type: values[0]?.text ?? keyword.text };
      open.modules.push({ ...module, line });
      return;
    }

    open.lines.push({
      line,
      keyword,
      values,
      module: module?.slot ?? '',
      moduleType: module?.type ?? '',
      moduleIndex: module ? open.modules.length - 1 : -1,
    });
  });

  return found;
};

/** A number with an optional one-letter `X:` prefix, or NaN */
export const parseIniNumber = (text: string): number => {
  const match = /^(?:[A-Za-z]:)?(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)%?$/i.exec(
    text,
  );

  return match ? Number(match[1]) : NaN;
};

const RANGE_ZERO: Range = { low: 0, high: 0 };
const RANGE_ONE: Range = { low: 1, high: 1 };

const rangeOf = (values: SageToken[]): Range | undefined => {
  const numbers = values.map((value) => parseIniNumber(value.text));

  if (numbers.length === 1 && !isNaN(numbers[0])) {
    return { low: numbers[0], high: numbers[0] };
  }
  if (numbers.length >= 2 && !isNaN(numbers[0]) && !isNaN(numbers[1])) {
    return { low: numbers[0], high: numbers[1] };
  }
  return undefined;
};

const coordOf = (values: SageToken[]): Vec3 => {
  const out: Vec3 = [0, 0, 0];

  values.slice(0, 3).forEach((value, index) => {
    const number = parseIniNumber(value.text);

    out[index] = isNaN(number) ? 0 : number;
  });
  return out;
};

const flagOf = (values: SageToken[]) => /^yes$/i.test(values[0]?.text ?? '');

const numberOf = (values: SageToken[], fallback: number) => {
  const number = parseIniNumber(values[0]?.text ?? '');

  return isNaN(number) ? fallback : number;
};

const blankDef = (name: string, form: 'block' | 'flat'): ParticleDef => ({
  name,
  form,
  shader: 'ADDITIVE',
  type: 'PARTICLE',
  lifetime: { ...RANGE_ZERO },
  systemLifetime: 0,
  initialDelay: { ...RANGE_ZERO },
  burstCount: { ...RANGE_ZERO },
  burstDelay: { ...RANGE_ZERO },
  size: { ...RANGE_ZERO },
  startSizeRate: { ...RANGE_ZERO },
  oneShot: false,
  groundAligned: false,
  upTowardsEmitter: false,
  volume: { type: 'point' },
  velocity: {
    type: 'ortho',
    x: { ...RANGE_ZERO },
    y: { ...RANGE_ZERO },
    z: { ...RANGE_ZERO },
  },
  gravity: 0,
  drift: [0, 0, 0],
  velocityDamping: { ...RANGE_ZERO },
  attachToBone: false,
  sizeRate: { ...RANGE_ZERO },
  sizeRateDamping: { ...RANGE_ONE },
  angleZ: { ...RANGE_ZERO },
  angularRateZ: { ...RANGE_ZERO },
  angularDamping: { ...RANGE_ONE },
  colors: Array.from({ length: 8 }, () => ({
    rgb: [0, 0, 0] as Vec3,
    frame: 0,
  })),
  alphas: Array.from({ length: 8 }, () => ({
    value: { ...RANGE_ZERO },
    frame: 0,
  })),
  hasAlphaBlock: false,
  colorScale: { ...RANGE_ZERO },
  slavePosOffset: [0, 0, 0],
});

/** The volume a flat form or `Emitter` block names by `VolumeType` */
const flatVolume = (fields: Map<string, SageToken[]>): Volume => {
  const get = (key: string) => fields.get(key.toLowerCase()) ?? [];
  const hollow = flagOf(get('IsHollow'));

  switch ((get('VolumeType')[0]?.text ?? 'POINT').toUpperCase()) {
    case 'LINE':
      return {
        type: 'line',
        start: coordOf(get('VolLineStart')),
        end: coordOf(get('VolLineEnd')),
      };
    case 'BOX':
      return { type: 'box', halfSize: coordOf(get('VolBoxHalfSize')), hollow };
    case 'SPHERE':
      return {
        type: 'sphere',
        radius: numberOf(get('VolSphereRadius'), 0),
        hollow,
      };
    case 'CYLINDER':
      return {
        type: 'cylinder',
        radius: numberOf(get('VolCylinderRadius'), 0),
        length: numberOf(get('VolCylinderLength'), 0),
        offset: [0, 0, 0],
        hollow,
      };
    default:
      return { type: 'point' };
  }
};

const flatVelocity = (fields: Map<string, SageToken[]>): Velocity => {
  const range = (key: string) =>
    rangeOf(fields.get(key.toLowerCase()) ?? []) ?? { ...RANGE_ZERO };

  switch ((fields.get('velocitytype')?.[0]?.text ?? 'ORTHO').toUpperCase()) {
    case 'SPHERICAL':
      return { type: 'spherical', speed: range('VelSpherical') };
    case 'HEMISPHERICAL':
      return { type: 'hemispherical', speed: range('VelHemispherical') };
    case 'CYLINDRICAL':
      return {
        type: 'cylindrical',
        radial: range('VelCylindricalRadial'),
        normal: range('VelCylindricalNormal'),
      };
    case 'OUTWARD':
      return {
        type: 'outward',
        speed: range('VelOutward'),
        otherSpeed: range('VelOutwardOther'),
      };
    default:
      return {
        type: 'ortho',
        x: range('VelOrthoX'),
        y: range('VelOrthoY'),
        z: range('VelOrthoZ'),
      };
  }
};

const moduleVolume = (
  type: string,
  fields: Map<string, SageToken[]>,
): Volume => {
  const get = (key: string) => fields.get(key.toLowerCase()) ?? [];
  const hollow = flagOf(get('IsHollow'));

  switch (type.toLowerCase()) {
    case 'pointemissionvolume':
      return { type: 'point' };
    case 'lineemissionvolume':
    case 'lightningemission':
      return {
        type: 'line',
        start: coordOf(get('StartPoint')),
        end: coordOf(get('EndPoint')),
      };
    case 'boxemissionvolume':
      return { type: 'box', halfSize: coordOf(get('HalfSize')), hollow };
    case 'sphereemissionvolume':
      return { type: 'sphere', radius: numberOf(get('Radius'), 0), hollow };
    case 'cylinderemissionvolume':
      return {
        type: 'cylinder',
        radius: numberOf(get('Radius'), 0),
        length: numberOf(get('Length'), 0),
        offset: coordOf(get('Offset')),
        hollow,
      };
    default:
      return { type: 'unread', module: type };
  }
};

const moduleVelocity = (
  type: string,
  fields: Map<string, SageToken[]>,
): Velocity => {
  const range = (key: string) =>
    rangeOf(fields.get(key.toLowerCase()) ?? []) ?? { ...RANGE_ZERO };

  switch (type.toLowerCase()) {
    case 'sphericalemissionvelocity':
      return { type: 'spherical', speed: range('Speed') };
    case 'hemisphericalemissionvelocity':
      return { type: 'hemispherical', speed: range('Speed') };
    case 'cylindricalemissionvelocity':
      return {
        type: 'cylindrical',
        radial: range('Radial'),
        normal: range('Normal'),
      };
    case 'outwardemissionvelocity':
      return {
        type: 'outward',
        speed: range('Speed'),
        otherSpeed: range('OtherSpeed'),
      };
    default:
      return { type: 'ortho', x: range('X'), y: range('Y'), z: range('Z') };
  }
};

const readWind = (fields: Map<string, SageToken[]>): Wind => {
  const number = (key: string, fallback: number) =>
    numberOf(fields.get(key.toLowerCase()) ?? [], fallback);
  const pair = (prefix: string): Range => ({
    low: number(`${prefix}Min`, 0),
    high: number(`${prefix}Max`, 0),
  });
  const motion = (fields.get('windmotion')?.[0]?.text ?? '').toLowerCase();

  return {
    motion:
      motion === 'pingpong'
        ? 'pingpong'
        : motion === 'circular'
          ? 'circular'
          : 'none',
    strength: number('WindStrength', 2),
    fullStrengthDist: number('WindFullStrengthDist', 75),
    zeroStrengthDist: number('WindZeroStrengthDist', 200),
    angleChange: pair('WindAngleChange'),
    start: pair('WindPingPongStartAngle'),
    end: pair('WindPingPongEndAngle'),
  };
};

/** Fields of one module, last write winning, keyed lowercased */
const fieldMap = (lines: IniLine[]) =>
  new Map(
    lines.map((entry) => [entry.keyword.text.toLowerCase(), entry.values]),
  );

/** Applies the fields any form writes at its own or a module's level */
const applyCommonFields = (def: ParticleDef, lines: IniLine[]): void => {
  for (const { keyword, values } of lines) {
    const key = keyword.text.toLowerCase();
    const range = rangeOf(values);
    const keySlot = /^(color|alpha)([1-8])$/.exec(key);

    if (keySlot) {
      const slot = Number(keySlot[2]) - 1;
      const numbers = values.map((value) => parseIniNumber(value.text));

      if (keySlot[1] === 'color' && numbers.length >= 4) {
        def.colors[slot] = {
          rgb: [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255],
          frame: Math.max(0, numbers[3] || 0),
        };
      } else if (keySlot[1] === 'alpha' && numbers.length >= 3) {
        def.alphas[slot] = {
          value: { low: numbers[0], high: numbers[1] },
          frame: Math.max(0, numbers[2] || 0),
        };
      }
      continue;
    }

    switch (key) {
      case 'particlename':
        def.particleName = values[0]?.text;
        break;
      case 'shader':
        def.shader = (values[0]?.text ?? 'ADDITIVE').toUpperCase();
        break;
      case 'type':
        def.type = (values[0]?.text ?? 'PARTICLE').toUpperCase();
        break;
      case 'priority':
        def.priority = values[0]?.text;
        break;
      case 'systemlifetime':
        def.systemLifetime = range ? (range.low + range.high) / 2 : 0;
        break;
      case 'isoneshot':
        def.oneShot = flagOf(values);
        break;
      case 'isgroundaligned':
        def.groundAligned = flagOf(values);
        break;
      case 'isparticleuptowardsemitter':
        def.upTowardsEmitter = flagOf(values);
        break;
      case 'slavesystem':
        def.slaveSystem = values[0]?.text;
        break;
      case 'slaveposoffset':
        def.slavePosOffset = coordOf(values);
        break;
      case 'perparticleattachedsystem':
        def.perParticleSystem = values[0]?.text;
        break;
      case 'gravity':
        def.gravity = numberOf(values, 0);
        break;
      case 'driftvelocity':
        def.drift = coordOf(values);
        break;
      case 'particlesattachtobone':
        def.attachToBone = flagOf(values);
        break;
      default: {
        const target = (
          {
            lifetime: 'lifetime',
            initialdelay: 'initialDelay',
            burstcount: 'burstCount',
            burstdelay: 'burstDelay',
            size: 'size',
            startsizerate: 'startSizeRate',
            velocitydamping: 'velocityDamping',
            sizerate: 'sizeRate',
            sizeratedamping: 'sizeRateDamping',
            anglez: 'angleZ',
            angularratez: 'angularRateZ',
            angulardamping: 'angularDamping',
            colorscale: 'colorScale',
          } as Record<string, keyof ParticleDef>
        )[key];

        if (target && range) {
          (def as unknown as Record<string, Range>)[target] = range;
        }
      }
    }
  }
};

/** Reads one `FXParticleSystem` or `ParticleSystem` definition */
export const readParticleDef = (definition: IniDefinition): ParticleDef => {
  const flat = definition.keyword === 'ParticleSystem';
  const def = blankDef(definition.name, flat ? 'flat' : 'block');

  applyCommonFields(def, definition.lines);

  if (flat) {
    const fields = fieldMap(definition.lines);

    def.volume = flatVolume(fields);
    def.velocity = flatVelocity(fields);
    def.hasAlphaBlock = true;
    if (fields.has('windmotion')) {
      def.wind = readWind(fields);
    }
    return def;
  }

  // A slot written with no fields still selects its module type
  const modules = new Map(
    definition.modules.map((module, index) => [
      module.slot.toLowerCase(),
      {
        type: module.type,
        lines: definition.lines.filter((line) => line.moduleIndex === index),
      },
    ]),
  );

  const volume = modules.get('emissionvolume');
  const velocity = modules.get('emissionvelocity');
  const emitter = modules.get('emitter');
  const draw = modules.get('draw');
  const wind = modules.get('wind');
  const event = modules.get('event');

  if (emitter) {
    const fields = fieldMap(emitter.lines);

    def.volume = flatVolume(fields);
    def.velocity = flatVelocity(fields);
  }
  if (volume) {
    def.volume = moduleVolume(volume.type, fieldMap(volume.lines));
  }
  if (velocity) {
    def.velocity = moduleVelocity(velocity.type, fieldMap(velocity.lines));
  }
  def.hasAlphaBlock = modules.has('alpha');
  if (draw) {
    def.drawModule = draw.type;

    const fields = fieldMap(draw.lines);
    const totalFrames = numberOf(fields.get('totalframes') ?? [], 0);
    const framesPerRow = numberOf(fields.get('framesperrow') ?? [], 0);

    if (totalFrames > 0 && framesPerRow > 0) {
      def.flipbook = {
        totalFrames,
        framesPerRow,
        speed: numberOf(fields.get('speedmultiplier') ?? [], 1),
      };
    }
  }
  if (wind) {
    def.wind = readWind(fieldMap(wind.lines));
  }
  if (event && /terraincollision/i.test(event.type)) {
    const fields = fieldMap(event.lines);

    def.event = {
      fx: fields.get('eventfx')?.[0]?.text,
      heightOffset: numberOf(fields.get('heightoffset') ?? [], 0),
      killAfterEvent: flagOf(fields.get('killafterevent') ?? []),
    };
  }
  return def;
};

/** Reads an `FXList`'s particle, sound and other nuggets */
export const readFxList = (definition: IniDefinition): FxListDef => {
  const nuggets = definition.modules.flatMap((module, index) => {
    if (!/^particlesystem$/i.test(module.slot)) {
      return [];
    }

    const fields = fieldMap(
      definition.lines.filter((line) => line.moduleIndex === index),
    );
    const system = fields.get('name')?.[0]?.text;

    if (!system) {
      return [];
    }
    return [
      {
        system,
        module: index,
        count: Math.max(1, Math.round(numberOf(fields.get('count') ?? [], 1))),
        offset: coordOf(fields.get('offset') ?? []),
        radius: rangeOf(fields.get('radius') ?? []) ?? { ...RANGE_ZERO },
        height: rangeOf(fields.get('height') ?? []) ?? { ...RANGE_ZERO },
        initialDelay: rangeOf(fields.get('initialdelay') ?? []) ?? {
          ...RANGE_ZERO,
        },
      },
    ];
  });

  const sounds = definition.modules.flatMap((module, index) => {
    if (!/^sound$/i.test(module.slot)) {
      return [];
    }

    const fields = fieldMap(
      definition.lines.filter((line) => line.moduleIndex === index),
    );
    const name = fields.get('name')?.[0]?.text;

    return name
      ? [
          {
            name,
            module: index,
            initialDelay: rangeOf(fields.get('initialdelay') ?? []) ?? {
              ...RANGE_ZERO,
            },
          },
        ]
      : [];
  });

  const effects = definition.modules.flatMap((module, index) => {
    if (/^(particlesystem|sound)$/i.test(module.slot)) {
      return [];
    }

    const fields = fieldMap(
      definition.lines.filter((line) => line.moduleIndex === index),
    );

    return [
      readFxEffect(
        module.slot,
        index,
        fields,
        rangeOf(fields.get('initialdelay') ?? []) ?? { ...RANGE_ZERO },
        parseIniNumber,
      ),
    ];
  });

  return { name: definition.name, nuggets, sounds, effects };
};

/** The names a particle system or FX list starts in turn */
export const referencedNames = (
  def: ParticleDef | FxListDef,
): { systems: string[]; fxLists: string[] } =>
  'nuggets' in def
    ? { systems: def.nuggets.map((nugget) => nugget.system), fxLists: [] }
    : {
        systems: [def.slaveSystem, def.perParticleSystem].filter(
          (name): name is string => !!name,
        ),
        fxLists: def.event?.fx ? [def.event.fx] : [],
      };

/** A number a slider can move: one value token of one field line */
export interface NumericField {
  /** `line:token`, stable while the text keeps its shape */
  id: string;
  line: number;
  token: number;
  module: string;
  /** Which of the definition's modules it sits in, -1 for none */
  moduleIndex: number;
  keyword: string;
  /** What the token is, like `max`, `G` or `frame` */
  part: string;
  value: number;
  /** Whether the value is a whole number by its meaning */
  integer: boolean;
}

const partNames = (keyword: string, count: number): string[] => {
  const key = keyword.toLowerCase();

  if (/^color[1-8]$/.test(key)) {
    return ['R', 'G', 'B', 'frame'];
  }
  if (/^alpha[1-8]$/.test(key)) {
    return ['min', 'max', 'frame'];
  }
  if (count === 3) {
    return ['X', 'Y', 'Z'];
  }
  if (count === 2) {
    return ['min', 'max'];
  }
  return Array.from({ length: count }, (_, index) =>
    count > 1 ? `${index + 1}` : '',
  );
};

/** Every numeric value of a definition, in order, for sliders */
export const numericFields = (definition: IniDefinition): NumericField[] =>
  definition.lines.flatMap((line) => {
    const parts = partNames(line.keyword.text, line.values.length);

    return line.values.flatMap((value, token) => {
      const number = parseIniNumber(value.text);

      if (isNaN(number)) {
        return [];
      }

      const part = parts[token] ?? `${token + 1}`;

      return [
        {
          id: `${line.line}:${token}`,
          line: line.line,
          token,
          module: line.module
            ? line.module === line.moduleType
              ? line.module
              : `${line.module} = ${line.moduleType}`
            : '',
          moduleIndex: line.moduleIndex,
          keyword: line.keyword.text,
          part,
          value: number,
          integer:
            part === 'frame' ||
            /^(color[1-8]|burstcount|burstdelay|lifetime|systemlifetime|initialdelay|totalframes|framesperrow|sortlevel)$/i.test(
              line.keyword.text,
            ),
        },
      ];
    });
  });

/** A number written the way the INI writes one */
export const formatIniNumber = (value: number, integer: boolean): string => {
  if (integer || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return String(Number(value.toFixed(4)));
};

/** One changed value: where it sits and what replaces it */
export interface ValueEdit {
  line: number;
  start: number;
  end: number;
  text: string;
}

/**
 * The text edits that write `values` (by field id) over a definition's
 * tokens, keeping each token's `X:` style prefix
 */
export const valueEdits = (
  definition: IniDefinition,
  values: ReadonlyMap<string, number>,
): ValueEdit[] =>
  numericFields(definition).flatMap((field) => {
    const value = values.get(field.id);

    if (value === undefined || value === field.value) {
      return [];
    }

    const token = definition.lines.find((line) => line.line === field.line)!
      .values[field.token];
    const prefix = /^[A-Za-z]:/.exec(token.text)?.[0] ?? '';

    return [
      {
        line: field.line,
        start: token.start,
        end: token.end,
        text: prefix + formatIniNumber(value, field.integer),
      },
    ];
  });

/** `text` with value edits applied, for previewing unsaved slider values */
export const applyValueEdits = (text: string, edits: ValueEdit[]): string => {
  const lines = text.split(/\r?\n/);
  const newline = /\r\n/.test(text) ? '\r\n' : '\n';

  [...edits]
    .sort((a, b) => b.line - a.line || b.start - a.start)
    .forEach((edit) => {
      const line = lines[edit.line];

      lines[edit.line] =
        line.slice(0, edit.start) + edit.text + line.slice(edit.end);
    });
  return lines.join(newline);
};
