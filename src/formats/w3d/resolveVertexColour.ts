import type { Rgb } from "./w3dMaterialChunks";
import type { W3dSurface, W3dVertexColourUse } from "./w3dMaterialTypes";

const isBlack = ([red, green, blue]: Rgb) => red === 0 && green === 0 && blue === 0;

/**
 * Resolves what a draw's vertex colours stand for: on the fixed-function path
 * by which of the material's colours are in use, the four branches of
 * `Post_Load_Process`. Any other mix leaves the colours as loaded, as diffuse.
 */
export const resolveVertexColour = (
  isEffect: boolean,
  { ambient, diffuse, emissive, opacity }: Pick<W3dSurface, "ambient" | "diffuse" | "emissive" | "opacity">,
): W3dVertexColourUse => {
  const unscaled: W3dVertexColourUse = {
    ambient: false,
    diffuse: true,
    replacesLighting: false,
    multipliesResult: false,
    scale: [1, 1, 1],
    alphaScale: 1,
  };

  if (isEffect) {
    return { ...unscaled, diffuse: false, multipliesResult: true };
  }

  const uses = [!isBlack(diffuse), !isBlack(ambient), !isBlack(emissive)].join();

  switch (uses) {
    case "true,false,false":
      return { ...unscaled, scale: diffuse, alphaScale: opacity };
    case "true,true,false":
      return { ...unscaled, ambient: true, scale: diffuse, alphaScale: opacity };
    case "false,true,false":
      return { ...unscaled, ambient: true, diffuse: false, scale: ambient, alphaScale: opacity };
    case "false,false,true":
      return { ...unscaled, replacesLighting: true, scale: emissive, alphaScale: opacity };
    default:
      return unscaled;
  }
};
