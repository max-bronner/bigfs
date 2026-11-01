import type { Rgb, W3dFxMaterial } from "./w3dMaterialChunks";
import { DEFAULT_SURFACE } from "./w3dMaterialTypes";

/** Reads a boolean parameter of a shader material; absent or of another type reads as false */
export const readFxBool = (material: W3dFxMaterial | undefined, name: string) =>
  material?.properties.get(name) === true;

/** Reads a colour parameter's red, green and blue; one with fewer channels reads as absent */
export const readFxColour = ({ properties }: W3dFxMaterial, name: string): Rgb | undefined => {
  const value = properties.get(name);

  return Array.isArray(value) && value.length >= 3 ? [value[0], value[1], value[2]] : undefined;
};

/** Reads a number parameter of a shader material */
export const readFxNumber = ({ properties }: W3dFxMaterial, name: string): number | undefined => {
  const value = properties.get(name);

  return typeof value === "number" ? value : undefined;
};

/** Reads a text parameter of a shader material */
export const readFxText = ({ properties }: W3dFxMaterial, name: string): string | undefined => {
  const value = properties.get(name);

  return typeof value === "string" ? value : undefined;
};

/**
 * Reads the texture a shader material binds by name, never by position: a
 * material is a list of named parameters, and `Simple.fx` calls its texture
 * `Texture_0`
 */
export const readFxDiffuseTexture = (material: W3dFxMaterial): string | undefined =>
  readFxText(material, "diffusetexture") ?? readFxText(material, "texture_0");

/**
 * Reads the colours a shader material sets. Its `AmbientColor` of 0.4 is left
 * out, as in mint: it multiplies a map's ambient, and the preview's stands for
 * the sum of them, which would draw every normal-mapped mesh dark.
 */
export const resolveFxColours = (material: W3dFxMaterial) => ({
  diffuse: readFxColour(material, "diffusecolor") ?? DEFAULT_SURFACE.diffuse,
  specular: readFxColour(material, "specularcolor") ?? DEFAULT_SURFACE.specular,
  shininess: readFxNumber(material, "specularexponent") ?? DEFAULT_SURFACE.shininess,
  bumpScale: readFxNumber(material, "bumpscale") ?? DEFAULT_SURFACE.bumpScale,
});
