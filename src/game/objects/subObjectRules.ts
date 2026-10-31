import type { SubObjectRule } from '../../formats/w3d/w3dScene';
import type { ObjectScene, SceneState } from './objectScene';

const IDLE_STATE = /^idleanimationstate/i;

/** Gets the state whose script has run while a state shows: a model state shows its draw module's idle */
const findScriptState = (
  scene: ObjectScene,
  state: SceneState,
): SceneState | undefined =>
  state.kind === 'animation'
    ? state
    : scene.states.find(
        (each) => each.draw === state.draw && IDLE_STATE.test(each.label),
      );

/**
 * Lists the writes to an object's sub-objects while it shows a state, last
 * write winning. The state's plain calls come first: as in mint's `UnitLook`,
 * the writes that last, made by upgrades and permanent calls, apply over them.
 * A part an upgrade shows starts hidden unless the upgrade is in force on
 * creation, as in mint's `SubObjectsUpgrade`.
 */
export const listSubObjectRules = (
  scene: ObjectScene,
  state: SceneState | undefined,
): SubObjectRule[] => {
  const calls = (state && findScriptState(scene, state))?.subObjects.rules ?? [];
  const granted = new Set(
    scene.created.grantedUpgrades.map((upgrade) => upgrade.toLowerCase()),
  );

  return [
    ...calls.filter((rule) => !rule.isPermanent),
    ...scene.pristineSubObjects,
    ...scene.upgrades
      .filter(
        (upgrade) =>
          !upgrade.startsActive &&
          !upgrade.triggers.some((each) => granted.has(each.toLowerCase())),
      )
      .flatMap(({ parts, triggers }) =>
        parts.map((pattern) => ({
          pattern,
          hide: true,
          source: `until ${triggers.join(' or ') || 'an upgrade'}`,
        })),
      ),
    ...scene.created.rules,
    ...calls.filter((rule) => rule.isPermanent),
  ];
};

/** Lists the calls a state or the object's creation makes under a condition, which are not applied */
export const listConditionalSubObjects = (
  scene: ObjectScene,
  state: SceneState | undefined,
): string[] => [
  ...new Set([
    ...((state && findScriptState(scene, state))?.subObjects.conditional ?? []),
    ...scene.created.conditional,
  ]),
];
