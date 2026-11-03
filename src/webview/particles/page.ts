import { ParticleWorld } from '../../formats/particles/particleSimulation';
import type { FxListDef } from '../../formats/particles/particleIni';
import type { ParticleDef } from '../../formats/particles/particleDef';
import type { FromPage, SceneMessage } from './protocol';
import { getVsCodeApi } from '../shared/vscodeApi';
import { createViewer } from '../shared/viewer/createViewer';

const api = getVsCodeApi<FromPage>();

/** Posts a message to the particle preview's editor */
export const post = (message: FromPage): void => api.postMessage(message);

/** Gets a page element by id, typed by the caller */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** The viewer the page runs on, with the page's overlays and panels in it */
export const viewer = createViewer($('viewer'), {
  onPickClip: (name) => post({ kind: 'loadAnimation', name }),
});

viewer.stage.append($('handles'), $('flash'), $('hud'));
viewer.side.append($('context'));

/** What the page previews */
export const state = {
  scene: undefined as SceneMessage | undefined,
  /** The systems the previewed block started */
  roots: [] as number[],
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
