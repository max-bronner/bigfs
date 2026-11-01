import type { Vec3 } from '../../formats/particles/particleDef';
import { $, viewer } from './page';

/** The offset of the bone the effect starts on */
export const attachment = {
  /** Offset of the chosen bone from the model's origin, in the bind pose; zero for the origin itself */
  bone: [0, 0, 0] as Vec3,
};

/** Computes where the model stands this frame: still, circling or going back and forth */
export const getModelOrigin = (): Vec3 => {
  const motion = $<HTMLSelectElement>('motion').value;
  const t = viewer.getTime();

  if (motion === 'circle') {
    return [Math.cos(t * 1.5) * 60, Math.sin(t * 1.5) * 60, 0];
  }
  if (motion === 'line') {
    return [Math.sin(t * 1.2) * 80, 0, 0];
  }
  return [0, 0, 0];
};

/** Computes where the previewed effect starts: the model's bone, wherever it stands */
export const getRootOrigin = (): Vec3 =>
  getModelOrigin().map((value, axis) => value + attachment.bone[axis]) as Vec3;
