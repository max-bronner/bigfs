import type { W3dBlend } from "../../formats/w3d/w3dMaterialTypes";

/** A draw as the order sees it: how it blends and its sort bin */
interface OrderedDraw {
  blend: W3dBlend;
  sortLevel: number;
}

/**
 * Puts draws in the order they are issued: the opaque ones first, in the order
 * given, so what blends over them finds them in the depth buffer; then the
 * blended ones by sort level, those of one level in the order given.
 */
export const orderDraws = <T extends OrderedDraw>(draws: readonly T[]): T[] => [
  ...draws.filter(({ blend }) => blend === "opaque"),
  ...draws
    .filter(({ blend }) => blend !== "opaque")
    .sort((a, b) => a.sortLevel - b.sortLevel),
];
