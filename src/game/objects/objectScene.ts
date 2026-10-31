import type { SageBlock, SageDocument, SageStatement } from '../../formats/ini/sageIniParser';
import { getAudioReferenceKind } from '../../formats/ini/sageAudioFields';
import type { SageIniSchema } from '../../formats/ini/sageIniSchema';
import type { SubObjectRule } from '../../formats/w3d/w3dScene';
import { readStateScript } from './subObjectScripts';
import type { CreatedSubObjects, ScriptedSubObjects } from './subObjectScripts';

/**
 * What an object shows: the models its draw modules switch between, the
 * animations each state plays, the FX each state starts and the particle
 * systems it keeps on bones, and the FX the object names elsewhere. Read
 * from the object as the game composes it, so a ChildObject shows what
 * it inherits.
 *
 * Every draw module is read by the same rule, from the fields the data
 * writes: a state block (`ModelConditionState`, `AnimationState`, …) is
 * whatever block holds a `Model`, an animation or a state FX, and an
 * animation state plays on its draw module's default model.
 */

/** Kind of state block: a model condition state, or an animation state */
export type StateKind = 'model' | 'animation';

/** One state block of a draw module: the model, animations, FX and particle systems it shows */
export interface SceneState {
  /** Tag of the draw module holding it */
  draw: string;
  kind: StateKind;
  /** The state's keyword and conditions, as written */
  label: string;
  model?: string;
  /** As written: `SKELETON.CLIP`, or a bare clip */
  animations: string[];
  fx: string[];
  particles: { bone: string; system: string }[];
  /** What the state's `BeginScript` shows and hides */
  subObjects: ScriptedSubObjects;
}

/** A `SubObjectsUpgrade` module: the parts it shows, and so hides until it fires */
export interface SceneUpgrade {
  /** Its `TriggeredBy` names */
  triggers: string[];
  parts: string[];
  startsActive: boolean;
}

/** Everything an object shows, as the object preview draws it */
export interface ObjectScene {
  name: string;
  states: SceneState[];
  /** FX the object names outside any state, by the field naming them */
  fx: { field: string; name: string }[];
  /** Sounds and announcer events the object names, by the field naming them */
  voices: { field: string; name: string }[];
  upgrades: SceneUpgrade[];
  /** `TransitionDamageFX`'s writes for an undamaged object */
  pristineSubObjects: SubObjectRule[];
  /** The `AILuaEventsList` names, whose handlers `created` is read from */
  luaEventLists: string[];
  /** What the object's `OnCreated` handlers do; empty until the scripts are read */
  created: CreatedSubObjects;
}

/** The part of a scene a preview opens on: the state and the name the source line points at */
export interface SceneFocus {
  /** Index into `states` */
  state?: number;
  animation?: string;
  fx?: string;
  system?: string;
}

const lower = (text: string) => text.toLowerCase();

const MODEL_FIELDS = new Set(['model']);
const ANIMATION_FIELDS = new Set(['animation', 'animationname']);
const DEFAULT_STATE = /^default/i;

/** Blocks holding a line, outermost first */
const findBlockChain = (blocks: readonly SageBlock[], line: number): SageBlock[] => {
  const chain: SageBlock[] = [];

  for (
    let level = blocks.find((b) => b.startLine <= line && line <= b.endLine);
    level;
    level = level.children.find((b) => b.startLine <= line && line <= b.endLine)
  ) {
    chain.push(level);
  }
  return chain;
};

/** Whether a statement names an FX list, by what the schema says it points at */
const namesFx = (schema: SageIniSchema, statement: SageStatement) =>
  schema
    .getReferenceNamespaces(statement.keyword.text, statement.context)
    .includes('FXList');

/** A block's header as written: its keyword and whatever follows */
const formatBlockHeader = (block: SageBlock) =>
  [block.keyword, block.name].filter(Boolean).join(' = ');

/**
 * The draw module and the state block a line sits in: the state is the
 * innermost block below the draw module that is a direct child of it
 */
const findDrawPlace = (blocks: readonly SageBlock[], line: number) => {
  const chain = findBlockChain(blocks, line);
  const at = chain.findIndex((block) => lower(block.keyword) === 'draw');

  return at < 0
    ? { draw: undefined, state: undefined }
    : { draw: chain[at], state: chain[at + 1] };
};

/**
 * Reads the object's scene from its composed definition. `isFx` and
 * `isSystem` say whether a name is a defined FX list or particle system,
 * since a field's values mix names with numbers and flags.
 * @param lines The text `parsed` was parsed from, for the scripts the parse skips; without it
 * no script is read
 */
export const readObjectScene = (
  parsed: SageDocument,
  schema: SageIniSchema,
  isFx: (name: string) => boolean,
  isSystem: (name: string) => boolean,
  lines: readonly string[] = [],
): ObjectScene | undefined => {
  const object = parsed.blocks.find((block) =>
    /^(object|childobject|objectreskin)$/i.test(block.keyword),
  );

  if (!object) {
    return undefined;
  }

  const states = new Map<SageBlock, SceneState>();
  const scene: ObjectScene = {
    name: object.name?.split(/\s+/)[0] ?? '',
    states: [],
    fx: [],
    voices: [],
    upgrades: [],
    pristineSubObjects: [],
    luaEventLists: [],
    created: { rules: [], conditional: [], grantedUpgrades: [] },
  };
  const upgrades = new Map<SageBlock, SceneUpgrade>();
  const upgradeOf = (block: SageBlock) => {
    let upgrade = upgrades.get(block);

    if (!upgrade) {
      upgrade = { triggers: [], parts: [], startsActive: false };
      upgrades.set(block, upgrade);
      scene.upgrades.push(upgrade);
    }
    return upgrade;
  };
  const stateOf = (draw: SageBlock, block: SageBlock) => {
    let state = states.get(block);

    if (!state) {
      state = {
        draw: draw.moduleTag ?? draw.moduleType ?? 'Draw',
        kind: /animation/i.test(block.keyword) ? 'animation' : 'model',
        label: formatBlockHeader(block),
        animations: [],
        fx: [],
        particles: [],
        subObjects: { rules: [], conditional: [] },
      };
      states.set(block, state);
      scene.states.push(state);
    }
    return state;
  };

  for (const statement of parsed.statements) {
    if (
      statement.kind !== 'field' ||
      statement.line <= object.startLine ||
      statement.line >= object.endLine ||
      !statement.values.length
    ) {
      continue;
    }

    const key = lower(statement.keyword.text);
    const values = statement.values.map((value) => value.text);
    const { draw, state } = findDrawPlace(parsed.blocks, statement.line);
    const owner = draw && state ? stateOf(draw, state) : undefined;

    if (key === 'ailuaeventslist') {
      scene.luaEventLists.push(values[0]);
      continue;
    }
    if (key === 'pristinehidesubobject' || key === 'pristineshowsubobject') {
      scene.pristineSubObjects.push(
        ...values.map((pattern) => ({
          pattern,
          hide: key === 'pristinehidesubobject',
          source: statement.keyword.text,
        })),
      );
      continue;
    }

    const upgradeModule = findBlockChain(parsed.blocks, statement.line).find(
      (block) => lower(block.moduleType ?? '') === 'subobjectsupgrade',
    );

    if (upgradeModule && key === 'showsubobjects') {
      upgradeOf(upgradeModule).parts.push(...values);
      continue;
    }
    if (upgradeModule && key === 'triggeredby') {
      upgradeOf(upgradeModule).triggers.push(...values);
      continue;
    }
    if (upgradeModule && key === 'startsactive') {
      upgradeOf(upgradeModule).startsActive = /^yes$/i.test(values[0]);
      continue;
    }

    // Every field the audio tables call a sound, inherited ones included
    // since the object is read as composed; `NONE` is the engine's "no sound"
    if (getAudioReferenceKind(statement.context, statement.keyword.text)) {
      for (const name of values.filter((value) => !/^none$/i.test(value))) {
        if (
          !scene.voices.some(
            (voice) =>
              voice.name === name && voice.field === statement.keyword.text,
          )
        ) {
          scene.voices.push({ field: statement.keyword.text, name });
        }
      }
      continue;
    }

    if (owner && MODEL_FIELDS.has(key)) {
      owner.model = values[0];
    } else if (owner && ANIMATION_FIELDS.has(key) && values[0] !== 'NONE') {
      owner.animations.push(values[0]);
    } else if (owner && key === 'particlesysbone' && values.length > 1) {
      if (isSystem(values[1])) {
        owner.particles.push({ bone: values[0], system: values[1] });
      }
    } else if (namesFx(schema, statement)) {
      for (const name of values.filter(isFx)) {
        if (owner) {
          owner.fx.push(name);
        } else {
          scene.fx.push({ field: statement.keyword.text, name });
        }
      }
    }
  }

  for (const { startLine, endLine } of lines.length ? parsed.scripts : []) {
    const { draw, state } = findDrawPlace(parsed.blocks, startLine);

    if (draw && state && startLine > object.startLine && endLine < object.endLine) {
      const owner = stateOf(draw, state);
      const { rules, conditional } = readStateScript(
        lines.slice(startLine + 1, endLine).join('\n'),
        `${owner.label} script`,
      );

      owner.subObjects.rules.push(...rules);
      owner.subObjects.conditional.push(...conditional);
    }
  }

  // An animation state plays on its draw module's default model
  const defaults = new Map<string, string>();

  for (const state of scene.states) {
    if (state.model && DEFAULT_STATE.test(state.label)) {
      defaults.set(state.draw, state.model);
    }
  }
  for (const state of scene.states) {
    state.model ??=
      defaults.get(state.draw) ??
      scene.states.find((other) => other.draw === state.draw && other.model)
        ?.model;
  }

  // Blocks that held nothing to show, such as a transition's settings, go
  scene.states = scene.states.filter(
    (state) =>
      state.model ||
      state.animations.length ||
      state.fx.length ||
      state.particles.length,
  );
  return scene;
};

/**
 * Finds what a line of the source definition points at, matched into the
 * scene: its state by draw module and header, and the animation, FX or
 * particle system the line itself names
 */
export const findSceneFocus = (
  parsed: SageDocument,
  line: number,
  scene: ObjectScene,
): SceneFocus => {
  const { draw, state } = findDrawPlace(parsed.blocks, line);
  const focus: SceneFocus = {};

  if (draw && state) {
    const tag = draw.moduleTag ?? draw.moduleType ?? 'Draw';
    const at = scene.states.findIndex(
      (each) =>
        lower(each.draw) === lower(tag) &&
        lower(each.label) === lower(formatBlockHeader(state)),
    );

    focus.state = at < 0 ? undefined : at;
  }

  const statement = parsed.statements.find((each) => each.line === line);
  const key = lower(statement?.keyword.text ?? '');
  const values = statement?.values.map((value) => value.text) ?? [];
  const named = (list: readonly string[]) =>
    values.find((value) => list.some((each) => lower(each) === lower(value)));
  const states =
    focus.state === undefined ? scene.states : [scene.states[focus.state]];

  if (ANIMATION_FIELDS.has(key)) {
    focus.animation = named(states.flatMap((each) => each.animations));
  } else if (key === 'particlesysbone') {
    focus.system = named(
      states.flatMap((each) => each.particles.map((p) => p.system)),
    );
  } else {
    focus.fx = named([
      ...states.flatMap((each) => each.fx),
      ...scene.fx.map((each) => each.name),
    ]);
  }
  return focus;
};
