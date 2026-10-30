import type {
  FxListDef,
  ParticleDef,
  Range,
  Vec3,
  Volume,
} from './particleIni';

/**
 * The particle simulation the preview runs, at the games' fixed 30 Hz step.
 * Every rule here is the Generals engine's as BFME keeps it, recorded in
 * mint's `particles.md` §5: bursts and delays, the volumes and velocity
 * types, gravity/damping/drift integration, piecewise-linear colour and alpha
 * keys (alpha snapped, colour not), `ColorScale` as a birth roll, wind as a
 * position push, `StartSizeRate`'s running bonus, slave systems and systems
 * attached per particle. Where the games' behaviour is not settled the
 * choice is an option, so the preview can show either reading.
 *
 * Runs in the webview: no Node or VS Code imports.
 */

/** Simulation steps per second, the games' fixed particle rate; INI times count these frames */
export const STEP_HZ = 30;
/** EA's per-system batch; particles past it are not drawn */
export const BATCH_LIMIT = 512;
/** Most live particles over every system, so a runaway slider cannot hang the preview */
export const WORLD_LIMIT = 30_000;
/** Deepest chain of systems starting systems the world follows */
export const MAX_DEPTH = 4;
const MAX_SIZE_BONUS = 50;
const MIN_WIND_ANGLE_CHANGE = 0.005;
const WIND_ANGLE_CHANGE_DEFAULT = 0.15;
const TWO_PI = Math.PI * 2;

/** Readings of unsettled game behaviour the preview lets the user choose between */
export interface SimulationOptions {
  /** `retail` applies `WindStrength` as written; `doubled` is the older reading */
  wind: 'retail' | 'off' | 'doubled';
  /**
   * A hollow box: its surface, or the point EA's release falls through to
   * (a `break` misplaced in its `BOX` case, `particles.md` §5b)
   */
  hollowBox: 'surface' | 'point';
  /** Whether particles start their own systems: per-particle attached systems, events */
  compound: boolean;
  /** Whether to drop particles past EA's 512 per system, as the game does */
  batchLimit: boolean;
}

/** One live particle; `previous*` fields hold the last frame's values for drawing between steps */
export interface Particle {
  position: Vec3;
  previous: Vec3;
  velocity: Vec3;
  emitter: Vec3;
  size: number;
  previousSize: number;
  sizeRate: number;
  sizeRateDamping: number;
  angle: number;
  previousAngle: number;
  angularRate: number;
  angularDamping: number;
  velocityDamping: number;
  age: number;
  lifetime: number;
  color: Vec3;
  previousColor: Vec3;
  colorRate: Vec3;
  colorSlot: number;
  colorValues: Vec3[];
  alpha: number;
  previousAlpha: number;
  alphaRate: number;
  alphaSlot: number;
  alphaValues: number[];
  windJitter: number;
  /** The particle's own first flipbook cell */
  sheetStart: number;
  /** Id of the system attached to this particle, if one is */
  attached?: number;
  hasCollided: boolean;
}

/** One running particle system in a `ParticleWorld` */
export interface LiveSystem {
  id: number;
  name: string;
  origin: Vec3;
  previousOrigin: Vec3;
  delayLeft: number;
  burstLeft: number;
  age: number;
  isEmitting: boolean;
  /** A slave, which emits only when its master does */
  driven: boolean;
  slave?: number;
  depth: number;
  sizeBonus: number;
  wind: {
    angle: number;
    change: number;
    start: number;
    end: number;
    angleChange: number;
  };
  particles: Particle[];
  dropped: number;
}

/** Source of the definitions a `ParticleWorld` reads; the preview swaps these live */
export interface DefinitionSource {
  /** Finds a particle system by name */
  findSystem(name: string): ParticleDef | undefined;
  /** Finds an FX list by name */
  findFxList(name: string): FxListDef | undefined;
}

/** Small seeded random generator, so a restart replays the same picture */
export class Random {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** Rolls a number in [0, 1) */
  public nextUnit(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;

    let t = this.state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Rolls a number within a range; a reversed pair stays reversed, as EA's roll leaves it */
  public rollRange(range: Range): number {
    return range.low + (range.high - range.low) * this.nextUnit();
  }

  /** Rolls a number in [-1, 1) */
  public signed(): number {
    return this.nextUnit() * 2 - 1;
  }

  /** Rolls a unit vector, uniform over the sphere */
  public nextDirection(): Vec3 {
    const z = this.signed();
    const angle = this.nextUnit() * TWO_PI;
    const r = Math.sqrt(Math.max(0, 1 - z * z));

    return [r * Math.cos(angle), r * Math.sin(angle), z];
  }

  /** Rolls a unit vector in the horizontal plane */
  public directionXY(): [number, number] {
    const angle = this.nextUnit() * TWO_PI;

    return [Math.cos(angle), Math.sin(angle)];
  }
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** EA's `normalize` leaves a zero vector alone */
const normalize = (a: Vec3): Vec3 => {
  const size = length(a);

  return size > 1e-12 ? scale(a, 1 / size) : [0, 0, 0];
};

/** Rolls where in its volume a particle is born, in the system's frame */
export const rollVolumeOffset = (
  volume: Volume,
  random: Random,
  hollowBox: SimulationOptions['hollowBox'],
): Vec3 => {
  switch (volume.type) {
    case 'line': {
      const t = random.nextUnit();

      return add(volume.start, scale(sub(volume.end, volume.start), t));
    }
    case 'box': {
      const [hx, hy, hz] = volume.halfSize;
      const inside: Vec3 = [
        hx * random.signed(),
        hy * random.signed(),
        hz * random.signed(),
      ];

      if (!volume.hollow) {
        return inside;
      }
      if (hollowBox === 'point') {
        return [0, 0, 0];
      }

      const face = random.nextUnit() < 0.5 ? -1 : 1;
      const axis = Math.min(2, Math.floor(random.nextUnit() * 3));

      inside[axis] = volume.halfSize[axis] * face;
      return inside;
    }
    case 'sphere': {
      const direction = random.nextDirection();
      const reach = volume.hollow
        ? volume.radius
        : volume.radius * random.nextUnit();

      return scale(direction, reach);
    }
    case 'cylinder': {
      const [x, y] = random.directionXY();
      const reach = volume.hollow
        ? volume.radius
        : volume.radius * random.nextUnit();

      return [
        x * reach + volume.offset[0],
        y * reach + volume.offset[1],
        volume.length * 0.5 * random.signed() + volume.offset[2],
      ];
    }
    default:
      return [0, 0, 0];
  }
};

/** Rolls the velocity a particle is born with; `OUTWARD` reads the volume */
export const rollBirthVelocity = (
  def: ParticleDef,
  offset: Vec3,
  random: Random,
): Vec3 => {
  const velocity = def.velocity;

  switch (velocity.type) {
    case 'ortho':
      return [
        random.rollRange(velocity.x),
        random.rollRange(velocity.y),
        random.rollRange(velocity.z),
      ];
    case 'spherical':
      return scale(random.nextDirection(), random.rollRange(velocity.speed));
    case 'hemispherical': {
      const [x, y, z] = random.nextDirection();

      return scale([x, y, Math.abs(z)], random.rollRange(velocity.speed));
    }
    case 'cylindrical': {
      const [x, y] = random.directionXY();
      const out = random.rollRange(velocity.radial);

      return [x * out, y * out, random.rollRange(velocity.normal)];
    }
    case 'outward': {
      const speed = random.rollRange(velocity.speed);
      const other = random.rollRange(velocity.otherSpeed);
      const volume = def.volume;

      if (volume.type === 'cylinder') {
        const flat = normalize([offset[0], offset[1], 0]);

        return [flat[0] * speed, flat[1] * speed, other];
      }
      if (volume.type === 'sphere' || volume.type === 'box') {
        return scale(normalize(offset), speed);
      }
      if (volume.type === 'line') {
        const along = normalize(sub(volume.end, volume.start));
        const side = normalize(cross(along, [0, 0, 1]));
        const up = normalize(cross(side, along));

        return add(scale(side, speed), scale(up, other));
      }
      return scale(random.nextDirection(), speed);
    }
  }
};

/** Computes the per-frame step toward the key after `slot` */
const keyRate = (
  frames: number[],
  slot: number,
  target: number,
  from: number,
): number => {
  const here = frames[slot];
  const there = frames[slot + 1];

  if (there === undefined || there === 0 || there <= here) {
    return 0;
  }
  return (target - from) / (there - here);
};

/** Finds the next key slot a particle of `age` has reached, if any */
const reachedKey = (frames: number[], current: number, age: number) => {
  const frame = frames[current + 1];

  return frame === undefined || frame === 0 || age < frame
    ? undefined
    : current + 1;
};

/** Computes the angle that points a sprite away from its emitter, as EA computes it */
export const computeAngleAwayFrom = (position: Vec3, emitter: Vec3): number => {
  const x = position[0] - emitter[0];
  const y = position[1] - emitter[1];

  if (y === 0) {
    return x > 0 ? TWO_PI : Math.PI;
  }

  const size = Math.hypot(x, y);
  const theta = Math.acos(Math.max(-1, Math.min(1, y / size)));

  return x > 0 ? theta + Math.PI : Math.PI - theta;
};

const windFalloff = (distance: number, full: number, zero: number) => {
  if (distance <= full) {
    return 1;
  }
  if (distance >= zero || zero <= full) {
    return 0;
  }
  return (zero - distance) / (zero - full);
};

/** Particle simulation of every running system, stepped one 30 Hz frame at a time */
export class ParticleWorld {
  public readonly systems: LiveSystem[] = [];
  public options: SimulationOptions = {
    wind: 'retail',
    hollowBox: 'surface',
    compound: true,
    batchLimit: true,
  };
  /** Particles refused by the batch or world limit, since the last clear */
  public dropped = 0;
  /** 30 Hz frames stepped since the last clear */
  public frame = 0;
  private random: Random;
  private nextId = 1;
  private live = 0;
  private pending: { at: number; name: string; origin: Vec3; depth: number }[] =
    [];

  public constructor(
    private source: DefinitionSource,
    private seed = 1,
  ) {
    this.random = new Random(seed);
  }

  /** Swaps where definitions come from; live systems pick it up next frame */
  public setSource(source: DefinitionSource): void {
    this.source = source;
  }

  /** Number of live particles over every system */
  public get liveParticles(): number {
    return this.live;
  }

  /** Removes every system and reseeds, so the next run replays the same picture */
  public clear(): void {
    this.systems.length = 0;
    this.pending.length = 0;
    this.live = 0;
    this.dropped = 0;
    this.frame = 0;
    this.random = new Random(this.seed);
  }

  /** Starts a system; returns its id, or `undefined` for an unknown name or too deep a chain */
  public spawn(
    name: string,
    origin: Vec3,
    delayFrames = 0,
    depth = 0,
    driven = false,
  ): number | undefined {
    const def = this.source.findSystem(name);

    if (!def || depth > MAX_DEPTH) {
      return undefined;
    }

    const wind = { angle: 0, change: 1, start: 0, end: 0, angleChange: 0 };

    if (def.wind) {
      wind.start = this.random.rollRange(def.wind.start);
      wind.end = this.random.rollRange(def.wind.end);
      wind.angle = this.random.rollRange({ low: wind.start, high: wind.end });
      wind.angleChange = WIND_ANGLE_CHANGE_DEFAULT;
    }

    const system: LiveSystem = {
      id: this.nextId++,
      name,
      origin: [...origin],
      previousOrigin: [...origin],
      delayLeft: driven
        ? 0
        : Math.max(0, delayFrames) + this.random.rollRange(def.initialDelay),
      burstLeft: 0,
      age: 0,
      isEmitting: true,
      driven,
      depth,
      sizeBonus: 0,
      wind,
      particles: [],
      dropped: 0,
    };

    this.systems.push(system);
    if (def.slaveSystem && !driven) {
      system.slave = this.spawn(def.slaveSystem, origin, 0, depth + 1, true);
    }
    return system.id;
  }

  /** Plays an FX list's particle nuggets at `origin` */
  public fire(name: string, origin: Vec3, depth = 0): number[] {
    const list = this.source.findFxList(name);

    if (!list || depth > MAX_DEPTH) {
      return [];
    }
    return list.nuggets.flatMap((nugget) =>
      Array.from({ length: nugget.count }, () => {
        const angle = this.random.nextUnit() * TWO_PI;
        const radius = this.random.rollRange(nugget.radius);
        const at: Vec3 = [
          origin[0] + nugget.offset[0] + radius * Math.cos(angle),
          origin[1] + nugget.offset[1] + radius * Math.sin(angle),
          origin[2] + nugget.offset[2] + this.random.rollRange(nugget.height),
        ];
        // Milliseconds to frames, rounding up
        const delay = Math.ceil(
          (this.random.rollRange(nugget.initialDelay) * STEP_HZ) / 1000,
        );

        return this.spawn(nugget.system, at, delay, depth);
      }).filter((id): id is number => id !== undefined),
    );
  }

  /** Finds a running system by id */
  public find(id: number | undefined): LiveSystem | undefined {
    return id === undefined
      ? undefined
      : this.systems.find((system) => system.id === id);
  }

  /** Moves a running system's origin */
  public setOrigin(id: number, origin: Vec3): void {
    const system = this.find(id);

    if (system) {
      system.origin = [...origin];
    }
  }

  /** Stops a system emitting; it is removed once its particles die */
  public stop(id: number | undefined): void {
    const system = this.find(id);

    if (system) {
      system.isEmitting = false;
    }
  }

  /** Advances the simulation one 30 Hz frame */
  public step(): void {
    this.frame++;
    for (let index = 0; index < this.systems.length; index++) {
      const system = this.systems[index];
      const def = this.source.findSystem(system.name);

      if (!def || !this.stepSystem(system, def)) {
        this.live -= system.particles.length;
        this.stopAttached(system.particles);
        this.stop(system.slave);
        this.systems.splice(index--, 1);
      }
    }
  }

  private stopAttached(particles: Particle[]): void {
    for (const particle of particles) {
      this.stop(particle.attached);
    }
  }

  private stepSystem(system: LiveSystem, def: ParticleDef): boolean {
    const moved = sub(system.origin, system.previousOrigin);

    system.previousOrigin = [...system.origin];

    if (system.delayLeft > 0) {
      system.delayLeft -= 1;
      return true;
    }
    if (def.systemLifetime > 0 && system.age >= def.systemLifetime) {
      system.isEmitting = false;
    }
    if (system.driven && !this.find(this.masterOf(system))) {
      system.isEmitting = false;
    }

    if (system.isEmitting && !system.driven) {
      if (system.burstLeft > 0) {
        system.burstLeft -= 1;
      } else {
        const count = Math.max(
          0,
          Math.min(BATCH_LIMIT, Math.trunc(this.random.rollRange(def.burstCount))),
        );

        for (let number = 0; number < count; number++) {
          const behind = 1 - number / count;
          const particle = this.admit(
            system,
            def,
            system.origin,
            moved,
            behind,
          );

          if (!particle) {
            continue;
          }
          if (def.perParticleSystem && this.options.compound) {
            particle.attached = this.spawn(
              def.perParticleSystem,
              particle.position,
              0,
              system.depth + 1,
            );
          }
          this.pushSlave(system, def, particle.position);
        }
        system.burstLeft = Math.max(0, this.random.rollRange(def.burstDelay));
        if (def.oneShot) {
          system.isEmitting = false;
        }
      }
    }

    const wind = this.windPush(system, def);
    const integrateAlpha = def.shader !== 'ADDITIVE';
    const colorFrames = def.colors.map((key) => key.frame);
    const alphaFrames = def.alphas.map((key) => key.frame);
    const before = system.particles.length;
    const events: Vec3[] = [];

    system.particles = system.particles.filter((particle) => {
      let alive = this.updateParticle(
        particle,
        def,
        system,
        wind,
        integrateAlpha,
        colorFrames,
        alphaFrames,
      );

      if (alive && def.event && !particle.hasCollided) {
        if (particle.position[2] <= def.event.heightOffset) {
          particle.hasCollided = true;
          events.push(particle.position);
          if (def.event.killAfterEvent) {
            alive = false;
          }
        }
      }
      if (particle.attached !== undefined) {
        if (alive) {
          this.setOrigin(particle.attached, particle.position);
        } else {
          this.stop(particle.attached);
        }
      }
      return alive;
    });
    this.live -= before - system.particles.length;
    system.age++;

    if (def.event?.fx && this.options.compound) {
      for (const at of events) {
        this.fire(def.event.fx, at, system.depth + 1);
      }
    }
    return system.isEmitting || system.particles.length > 0;
  }

  private masterOf(slave: LiveSystem): number | undefined {
    return this.systems.find((system) => system.slave === slave.id)?.id;
  }

  /** Births one particle into a system, unless a limit refuses it */
  private admit(
    system: LiveSystem,
    def: ParticleDef,
    origin: Vec3,
    moved: Vec3,
    behind: number,
  ): Particle | undefined {
    if (
      (this.options.batchLimit && system.particles.length >= BATCH_LIMIT) ||
      this.live >= WORLD_LIMIT
    ) {
      system.dropped++;
      this.dropped++;
      return undefined;
    }

    const particle = this.birth(def, origin, moved, behind);

    if (def.startSizeRate.low !== 0 || def.startSizeRate.high !== 0) {
      particle.size += system.sizeBonus;
      particle.previousSize = particle.size;
      system.sizeBonus = Math.min(
        MAX_SIZE_BONUS,
        system.sizeBonus + this.random.rollRange(def.startSizeRate),
      );
    }
    system.particles.push(particle);
    this.live++;
    return particle;
  }

  private pushSlave(master: LiveSystem, def: ParticleDef, at: Vec3): void {
    const slave = this.find(master.slave);
    const slaveDef = slave && this.source.findSystem(slave.name);

    if (slave && slaveDef) {
      this.admit(slave, slaveDef, add(at, def.slavePosOffset), [0, 0, 0], 0);
    }
  }

  private birth(
    def: ParticleDef,
    origin: Vec3,
    moved: Vec3,
    behind: number,
  ): Particle {
    const random = this.random;
    const local = rollVolumeOffset(def.volume, random, this.options.hollowBox);
    const velocity = rollBirthVelocity(def, local, random);
    const lifetime = Math.max(0, Math.round(random.rollRange(def.lifetime)));
    const alphaValues = def.alphas.map((key) => random.rollRange(key.value));
    const colorValues = def.colors.map((key) => [...key.rgb] as Vec3);
    const scaleRange = {
      low: def.colorScale.low / 255,
      high: def.colorScale.high / 255,
    };

    if (scaleRange.low !== 0 || scaleRange.high !== 0) {
      for (let slot = 1; slot < 7; slot++) {
        colorValues[slot] = colorValues[slot].map((channel) =>
          channel !== 0
            ? Math.max(0, Math.min(1, channel + random.rollRange(scaleRange)))
            : channel,
        ) as Vec3;
      }
    }

    const position = sub(add(origin, local), scale(moved, behind));
    const size = random.rollRange(def.size);
    const angle = random.rollRange(def.angleZ);
    const color: Vec3 = [...colorValues[0]];
    const alpha = alphaValues[0];
    const colorFrames = def.colors.map((key) => key.frame);
    const alphaFrames = def.alphas.map((key) => key.frame);

    return {
      position,
      previous: [...position],
      velocity,
      emitter: [...origin],
      size,
      previousSize: size,
      sizeRate: random.rollRange(def.sizeRate),
      sizeRateDamping: random.rollRange(def.sizeRateDamping),
      angle,
      previousAngle: angle,
      angularRate: random.rollRange(def.angularRateZ),
      angularDamping: random.rollRange(def.angularDamping),
      velocityDamping: random.rollRange(def.velocityDamping),
      age: 0,
      lifetime,
      color,
      previousColor: [...color],
      colorRate: [0, 1, 2].map((channel) =>
        keyRate(colorFrames, 0, colorValues[1][channel], color[channel]),
      ) as Vec3,
      colorSlot: 0,
      colorValues,
      alpha,
      previousAlpha: alpha,
      alphaRate: keyRate(alphaFrames, 0, alphaValues[1], alpha),
      alphaSlot: 0,
      alphaValues,
      windJitter: def.wind ? random.rollRange({ low: 0.7, high: 1.3 }) : 0,
      sheetStart: Math.floor(random.nextUnit() * 4096),
      hasCollided: false,
    };
  }

  private windPush(
    system: LiveSystem,
    def: ParticleDef,
  ):
    | { cos: number; sin: number; strength: number; full: number; zero: number }
    | undefined {
    const spec = def.wind;

    if (!spec || spec.motion === 'none') {
      return undefined;
    }

    const state = system.wind;

    if (spec.motion === 'circular') {
      if (state.angleChange === 0) {
        state.angleChange = Math.abs(this.random.rollRange(spec.angleChange));
      }
      state.angle =
        (state.angle + Math.max(state.angleChange, MIN_WIND_ANGLE_CHANGE)) %
        TWO_PI;
    } else {
      const low = Math.min(state.start, state.end);
      const high = Math.max(state.start, state.end);
      const half = (high - low) / 2;
      const fromEdge = Math.max(
        0,
        Math.min(state.angle - low, high - state.angle),
      );
      const ease = half > 0 ? Math.min(1, fromEdge / half) : 0;
      const step = Math.max(state.angleChange * ease, MIN_WIND_ANGLE_CHANGE);

      state.angle += state.change >= 0 ? step : -step;
      if (!(state.angle < high && state.angle > low)) {
        state.change = -state.change;
        state.angleChange = Math.abs(this.random.rollRange(spec.angleChange));
        state.start = this.random.rollRange(spec.start);
        state.end = this.random.rollRange(spec.end);
      }
    }

    const base =
      this.options.wind === 'off' ? 0 : this.options.wind === 'doubled' ? 2 : 1;

    return base
      ? {
          cos: Math.cos(state.angle),
          sin: Math.sin(state.angle),
          strength: base * spec.strength,
          full: spec.fullStrengthDist,
          zero: spec.zeroStrengthDist,
        }
      : undefined;
  }

  private updateParticle(
    particle: Particle,
    def: ParticleDef,
    system: LiveSystem,
    wind: ReturnType<ParticleWorld['windPush']>,
    integrateAlpha: boolean,
    colorFrames: number[],
    alphaFrames: number[],
  ): boolean {
    particle.previous = [...particle.position];
    particle.previousSize = particle.size;
    particle.previousAngle = particle.angle;
    particle.previousColor = [...particle.color];
    particle.previousAlpha = particle.alpha;

    if (def.attachToBone) {
      particle.position = [...system.origin];
    } else {
      particle.velocity[2] += def.gravity;
      particle.velocity = scale(particle.velocity, particle.velocityDamping);
      particle.position = add(
        particle.position,
        add(particle.velocity, def.drift),
      );
    }
    particle.angle += particle.angularRate;
    particle.angularRate *= particle.angularDamping;
    particle.size += particle.sizeRate;
    particle.sizeRate *= particle.sizeRateDamping;

    if (wind) {
      const distance = length(sub(particle.position, system.origin));
      const push =
        wind.strength *
        particle.windJitter *
        windFalloff(distance, wind.full, wind.zero);

      particle.position[0] += wind.cos * push;
      particle.position[1] += wind.sin * push;
    }
    if (def.upTowardsEmitter) {
      particle.angle = computeAngleAwayFrom(particle.position, particle.emitter);
      particle.previousAngle = particle.angle;
    }
    particle.age++;

    if (
      !particle.position.every(Number.isFinite) ||
      !Number.isFinite(particle.size)
    ) {
      return false;
    }

    for (let channel = 0; channel < 3; channel++) {
      particle.color[channel] = Math.max(
        0,
        Math.min(1, particle.color[channel] + particle.colorRate[channel]),
      );
    }

    const nextColor = reachedKey(colorFrames, particle.colorSlot, particle.age);

    if (nextColor !== undefined) {
      particle.colorSlot = nextColor;
      // Not snapped: `ColorScale` lives in the running colour
      particle.colorRate = [0, 1, 2].map((channel) =>
        keyRate(
          colorFrames,
          nextColor,
          particle.colorValues[nextColor + 1]?.[channel] ?? 0,
          particle.color[channel],
        ),
      ) as Vec3;
    }

    if (integrateAlpha) {
      particle.alpha = Math.max(
        0,
        Math.min(1, particle.alpha + particle.alphaRate),
      );

      const nextAlpha = reachedKey(
        alphaFrames,
        particle.alphaSlot,
        particle.age,
      );

      if (nextAlpha !== undefined) {
        particle.alphaSlot = nextAlpha;
        particle.alpha = Math.max(
          0,
          Math.min(1, particle.alphaValues[nextAlpha]),
        );
        particle.alphaRate = keyRate(
          alphaFrames,
          nextAlpha,
          particle.alphaValues[nextAlpha + 1] ?? 0,
          particle.alpha,
        );
      }
    }
    return particle.age < particle.lifetime;
  }
}
