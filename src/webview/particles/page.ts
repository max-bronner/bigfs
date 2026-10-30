import { ParticleWorld } from '../../formats/particles/particleSimulation';
import type {
  FxListDef,
  ParticleDef,
  Vec3,
} from '../../formats/particles/particleIni';
import type { FromPage, SceneMessage } from './protocol';
import { getVsCodeApi } from '../shared/vscodeApi';

const api = getVsCodeApi<FromPage>();

/** Posts a message to the particle preview's editor */
export const post = (message: FromPage): void => api.postMessage(message);

/** Gets a page element by id, typed by the caller */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** Playback and camera state of the particle page */
export const state = {
  scene: undefined as SceneMessage | undefined,
  playing: true,
  speed: 1,
  /** Seconds owed to the simulation, less than one step once caught up */
  accumulator: 0,
  /** Seconds since the last system ended, for looping */
  idle: 0,
  /** The systems the previewed block started */
  roots: [] as number[],
  yaw: -0.8,
  pitch: 0.45,
  distance: 220,
  target: [0, 0, 20] as Vec3,
  time: 0,
};

/** Definitions of the scene by lowercased name */
export const library = {
  systems: new Map<string, ParticleDef>(),
  fxLists: new Map<string, FxListDef>(),
};

/** Particle simulation the page steps and draws, resolving definitions from `library` */
export const world = new ParticleWorld(
  {
    findSystem: (name) => library.systems.get(name.toLowerCase()),
    findFxList: (name) => library.fxLists.get(name.toLowerCase()),
  },
  7,
);
