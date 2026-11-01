import { DEFAULT_SURFACE } from "../../formats/w3d/w3dMaterialTypes";
import type { W3dSurface } from "../../formats/w3d/w3dMaterialTypes";
import type { UniformLookup } from "./modelLocations";

/**
 * Sets the depth function, the culling and the material uniforms a draw's
 * surface asks for. Culling turns off for a two-sided draw and is left off by
 * the caller once its draws are done.
 */
export const applySurface = (
  gl: WebGLRenderingContext,
  uniform: UniformLookup,
  surface: W3dSurface,
): void => {
  const { vertexColour } = surface;

  gl.depthFunc(gl.NEVER + surface.depthCompare);
  if (surface.twoSided) {
    gl.disable(gl.CULL_FACE);
  } else {
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
  }
  gl.uniform3fv(uniform("materialAmbient"), surface.ambient);
  gl.uniform3fv(uniform("materialDiffuse"), surface.diffuse);
  gl.uniform3fv(uniform("materialEmissive"), surface.emissive);
  gl.uniform1i(uniform("unlit"), surface.unlit ? 1 : 0);
  gl.uniform1i(uniform("modulate2x"), surface.modulate2x ? 1 : 0);
  gl.uniform1i(uniform("ambientFromVertex"), vertexColour?.ambient ? 1 : 0);
  gl.uniform1i(uniform("diffuseFromVertex"), vertexColour?.diffuse ? 1 : 0);
  gl.uniform1i(uniform("vertexIsLit"), vertexColour?.replacesLighting ? 1 : 0);
  gl.uniform1i(uniform("vertexMultiplies"), vertexColour?.multipliesResult ? 1 : 0);
  gl.uniform3fv(uniform("vertexScale"), vertexColour?.scale ?? DEFAULT_SURFACE.diffuse);
  gl.uniform1f(uniform("vertexAlphaScale"), vertexColour?.alphaScale ?? 1);
  gl.uniform1i(uniform("detailColor"), surface.detailColor);
  gl.uniform1i(uniform("detailAlpha"), surface.detailAlpha);
  gl.uniform1i(uniform("bumpOffset"), surface.bumpOffset ? 1 : 0);
  gl.uniform3fv(uniform("specularColour"), surface.specular);
  gl.uniform1f(uniform("shininess"), surface.shininess);
  gl.uniform1f(uniform("bumpScale"), surface.bumpScale);
};
