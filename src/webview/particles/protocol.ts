import type {
  FxListDef,
  NumericField,
  ParticleDef,
} from '../../formats/particles/particleIni';
import type { KeyKind, KeyValue } from '../../formats/particles/particleKeys';

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
  /** Whether the preview shows the block as written, values held back */
  comparing: boolean;
  /** Particles each detail level allows, from the mod's StaticGameLOD blocks */
  budgets: { lod: string; max: number }[];
}

export type ToPage = SceneMessage | { kind: 'notice'; message: string };

export type FromPage =
  | { kind: 'ready' }
  | { kind: 'status'; frame: number; systems: number; particles: number }
  | { kind: 'set'; id: string; value: number }
  | { kind: 'setMany'; values: Record<string, number> }
  /** Shows the block as written (on) or with the values (off) */
  | { kind: 'compare'; on: boolean }
  | { kind: 'variant'; name?: string }
  | { kind: 'reset' }
  | { kind: 'apply' }
  /** Rewrites every colour or alpha key at once, with the values pending */
  | { kind: 'keys'; keyKind: KeyKind; keys: KeyValue[] }
  | { kind: 'reveal'; line: number };
