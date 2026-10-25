import type {
  FxListDef,
  NumericField,
  ParticleDef,
} from '../../formats/particles/particleIni';

/** Messages between the particle preview and its page */

export interface SceneMessage {
  kind: 'scene';
  /** Whether the page starts the effect over */
  restart: boolean;
  root: { kind: 'fxList' | 'system'; name: string; line: number };
  /** By lowercased name */
  systems: Record<string, ParticleDef>;
  fxLists: Record<string, FxListDef>;
  /** Data URIs by lowercased texture name; null for one not found */
  textures: Record<string, string | null>;
  notes: string[];
  fields: NumericField[];
  /** Slider values not yet applied, by field id */
  values: Record<string, number>;
}

export type ToPage = SceneMessage | { kind: 'notice'; message: string };

export type FromPage =
  | { kind: 'ready' }
  | { kind: 'status'; frame: number; systems: number; particles: number }
  | { kind: 'set'; id: string; value: number }
  | { kind: 'reset' }
  | { kind: 'apply' }
  | { kind: 'reveal'; line: number };
