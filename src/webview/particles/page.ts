import { ParticleWorld } from '../../formats/particles/particleSimulation';
import type {
  FxListDef,
  ParticleDef,
  Vec3,
} from '../../formats/particles/particleIni';
import type { FromPage, SceneMessage } from './protocol';
import { getVsCodeApi } from '../shared/vscodeApi';

const api = getVsCodeApi<FromPage>();

export const post = (message: FromPage): void => api.postMessage(message);

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** What the page shows and how the camera looks at it */
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

export const world = new ParticleWorld(
  {
    system: (name) => library.systems.get(name.toLowerCase()),
    fxList: (name) => library.fxLists.get(name.toLowerCase()),
  },
  7,
);
