import type { SubObjectRule } from '../../formats/w3d/w3dScene';
import { findIdleState } from './objectScene';
import type {
  BodyDamageState,
  ObjectScene,
  SceneState,
  SceneUpgrade,
} from './objectScene';
import type { ScriptedRule } from './subObjectScripts';

/** The damage states a state's condition flags can name, worst first */
const DAMAGE_CONDITIONS: readonly [RegExp, BodyDamageState][] = [
  [/\bRUBBLE\b/i, 'rubble'],
  [/\bREALLYDAMAGED\b/i, 'reallydamaged'],
  [/\bDAMAGED\b/i, 'damaged'],
];

/** Gets the state whose script has run while a state shows: a model state shows its draw module's idle */
const findScriptState = (
  scene: ObjectScene,
  state: SceneState,
): SceneState | undefined =>
  state.kind === 'animation' ? state : findIdleState(scene, state.draw);

/** Marks writes as permanent, as the game's upgrades and damage states all are */
const markPermanent = (rules: readonly SubObjectRule[]): ScriptedRule[] =>
  rules.map((rule) => ({ ...rule, isPermanent: true }));

/** Lists what `TransitionDamageFX` writes on entering a damage state: its hides, then its shows */
const listDamageWrites = (scene: ObjectScene, state: BodyDamageState) => {
  const rules = scene.damageSubObjects[state];

  return markPermanent([
    ...rules.filter((rule) => rule.hide),
    ...rules.filter((rule) => !rule.hide),
  ]);
};

/** Lists what a `SubObjectsUpgrade` writes when it fires: its hides, then its shows */
const listUpgradeWrites = ({ triggers, hides, shows }: SceneUpgrade) => {
  const source = `upgrade ${triggers.join(' or ')}`.trim();

  return markPermanent([
    ...hides.map((pattern) => ({ pattern, hide: true, source })),
    ...shows.map((pattern) => ({ pattern, hide: false, source })),
  ]);
};

/** Lists what an object's creation writes, an upgrade's writes at the point it is granted */
const listCreatedWrites = (scene: ObjectScene): ScriptedRule[] => {
  const { rules, grantedUpgrades } = scene.created;
  const listGrantedAt = (at: number) =>
    grantedUpgrades
      .filter((upgrade) => upgrade.at === at)
      .flatMap(({ name }) =>
        scene.upgrades
          .filter(({ triggers }) =>
            triggers.some((each) => each.toLowerCase() === name.toLowerCase()),
          )
          .flatMap(listUpgradeWrites),
      );

  return [
    ...rules.flatMap((rule, at) => [...listGrantedAt(at), rule]),
    ...listGrantedAt(rules.length),
  ];
};

/**
 * Keeps one write a name, as the game's two lists do: a later write of a name
 * changes the entry in place, so it keeps the first write's turn.
 */
const keepOneWritePerName = (writes: readonly SubObjectRule[]) => [
  ...new Map(writes.map((write) => [write.pattern.toLowerCase(), write])).values(),
];

/** Whether switching to a state drops the plain writes: it brings a new model and does not retain them */
const dropsPlainWrites = (state: SceneState, idle: SceneState | undefined) =>
  !state.retainsSubObjects &&
  state.model?.toLowerCase() !== (idle ?? state).model?.toLowerCase();

const findDamageState = (state: SceneState | undefined) =>
  DAMAGE_CONDITIONS.find(([condition]) => state && condition.test(state.label))?.[1];

/**
 * Lists the writes to an object's sub-objects while it shows a state, in the
 * order the game applies them, reached from a new object by way of its idle
 * state. The game holds two lists a draw module and applies the plain one
 * first, however late a permanent write came, so a plain write never beats a
 * permanent one. A plain write outlasts its state; only a switch to another
 * model clears those. A `SubObjectsUpgrade` writes nothing until it fires.
 */
export const listSubObjectRules = (
  scene: ObjectScene,
  state: SceneState | undefined,
): SubObjectRule[] => {
  const scripted = state && findScriptState(scene, state);
  const idle = state && findIdleState(scene, state.draw);
  const calls = [
    ...(idle && idle !== scripted ? idle.subObjects.rules : []),
    ...(scripted?.subObjects.rules ?? []),
  ];
  const created = listCreatedWrites(scene);
  const damage = findDamageState(state);

  return [
    ...keepOneWritePerName(
      [...(state && dropsPlainWrites(state, idle) ? [] : created), ...calls].filter(
        (rule) => !rule.isPermanent,
      ),
    ),
    ...keepOneWritePerName([
      ...listDamageWrites(scene, 'pristine'),
      ...scene.upgrades
        .filter((upgrade) => upgrade.startsActive)
        .flatMap(listUpgradeWrites),
      ...created.filter((rule) => rule.isPermanent),
      ...(damage ? listDamageWrites(scene, damage) : []),
      ...calls.filter((rule) => rule.isPermanent),
    ]),
  ];
};

/** Lists the calls a state or the object's creation makes under a condition, which are not applied */
export const listConditionalSubObjects = (
  scene: ObjectScene,
  state: SceneState | undefined,
): string[] => {
  const scripted = state && findScriptState(scene, state);
  const idle = state && findIdleState(scene, state.draw);

  return [
    ...new Set([
      ...(idle?.subObjects.conditional ?? []),
      ...(scripted?.subObjects.conditional ?? []),
      ...scene.created.conditional,
    ]),
  ];
};
