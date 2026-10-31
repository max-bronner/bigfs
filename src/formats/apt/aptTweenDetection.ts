import { EASINGS } from '../../core/expression';
import { getPose } from './aptPose';
import type { Pose } from './aptPose';
import type { FrameState } from './aptTimeline';

/** A run of frames in which one instance follows a tween */
export interface DetectedTween {
  depth: number;
  from: number;
  to: number;
  easing: string;
  start: Pose;
  end: Pose;
  /** The properties that change over it */
  changes: (keyof Pose)[];
}

const POSE_KEYS: (keyof Pose)[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'skew',
  'alpha',
];

/** How far a value may stray from the curve: a little of the change, and rounding */
const TOLERANCE: Record<keyof Pose, number> = {
  x: 0.06,
  y: 0.06,
  scaleX: 0.002,
  scaleY: 0.002,
  rotation: 0.06,
  skew: 0.002,
  alpha: 0.006,
};

/** The easing every changing property of `poses` follows, if one does */
const fitEasing = (
  poses: Pose[],
): { easing: string; changes: (keyof Pose)[] } | undefined => {
  const first = poses[0];
  const last = poses[poses.length - 1];
  const n = poses.length - 1;
  const changes = POSE_KEYS.filter(
    (key) => Math.abs(last[key] - first[key]) > TOLERANCE[key],
  );

  if (!changes.length) {
    return undefined;
  }
  // Still properties must stay still
  for (const key of POSE_KEYS.filter((each) => !changes.includes(each))) {
    if (
      poses.some((pose) => Math.abs(pose[key] - first[key]) > TOLERANCE[key])
    ) {
      return undefined;
    }
  }

  const easing = Object.entries(EASINGS).find(
    ([name, ease]) =>
      name !== 'step' &&
      poses.every((pose, i) =>
        changes.every((key) => {
          const expected = first[key] + (last[key] - first[key]) * ease(i / n);

          return (
            Math.abs(pose[key] - expected) <=
            TOLERANCE[key] + Math.abs(last[key] - first[key]) * 0.01
          );
        }),
      ),
  )?.[0];

  return easing ? { easing, changes } : undefined;
};

/**
 * Finds where the frames of a timeline are a tween: an instance whose pose
 * changes every frame along one easing curve, for at least three frames.
 * APT keeps those frames baked; seeing them as one tween lets a tween be
 * changed as one.
 */
export const detectTweens = (states: FrameState[]): DetectedTween[] => {
  const depths = new Set(states.flatMap((state) => [...state.display.keys()]));
  const found: DetectedTween[] = [];

  for (const depth of [...depths].sort((a, b) => a - b)) {
    const slots = states.map((state) => state.display.get(depth));
    const poses = slots.map((slot) => slot && getPose(slot));
    const moves = (at: number) =>
      !!slots[at] &&
      slots[at]!.token === slots[at - 1]?.token &&
      POSE_KEYS.some(
        (key) => Math.abs(poses[at]![key] - poses[at - 1]![key]) > 1e-6,
      );

    for (let from = 0; from < states.length - 2;) {
      // The run in which the instance moves every frame
      let end = from;

      while (end + 1 < states.length && moves(end + 1)) {
        end++;
      }
      if (end - from < 2) {
        from = Math.max(from + 1, end);
        continue;
      }

      // Its longest start that follows one curve; the rest is looked at next
      let matched = false;

      for (let to = end; to >= from + 2; to--) {
        const fit = fitEasing(poses.slice(from, to + 1) as Pose[]);

        if (fit) {
          found.push({
            depth,
            from,
            to,
            easing: fit.easing,
            start: poses[from]!,
            end: poses[to]!,
            changes: fit.changes,
          });
          from = to;
          matched = true;
          break;
        }
      }
      if (!matched) {
        from++;
      }
    }
  }
  return found;
};
