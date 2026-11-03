import type { W3dBlend, W3dSurface } from "./w3dMaterialTypes";

/** Additive wins over alpha over the rest, as a glow must never turn solid */
const BLEND_RANK: W3dBlend[] = [
  "opaque",
  "multiply",
  "addInverseScaledByColor",
  "addScaledByColor",
  "addScaledByAlpha",
  "alpha",
  "additive",
];

/** Picks the blend a mesh reports for its draws: the most transparent */
export const pickMeshBlend = (surfaces: readonly W3dSurface[]): W3dBlend =>
  surfaces.reduce<W3dBlend>(
    (best, { blend }) =>
      BLEND_RANK.indexOf(blend) > BLEND_RANK.indexOf(best) ? blend : best,
    "opaque",
  );
