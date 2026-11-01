import type { W3dSurface } from "./w3dMaterialTypes";
import { isUvMapperAnimated } from "./w3dUvMapper";

/** Whether a surface changes with the preview's clock */
export const isSurfaceAnimated = ({ mappers }: W3dSurface): boolean =>
  !!mappers?.some(isUvMapperAnimated);
