/**
 * The GLSL of the model renderer. The fragment shader composes what a W3D
 * material asks for in the order the engine does: the texture, then the
 * material's lit colour, as `w3d-shading.md` lays out and mint's
 * `shader.wgsl` draws it. WebGL 1.
 */

/** Vertex shader of the model renderer */
export const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 viewProjection;
uniform vec3 offset;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vNormal = normal;
  vUv = uv;
  vColor = color;
  gl_Position = viewProjection * vec4(position + offset, 1.0);
}`;

/** Fragment shader of the model renderer */
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec2 vUv;
varying vec4 vColor;
uniform sampler2D tex;
uniform bool hasTexture;
uniform bool hasNormals;
uniform vec3 lightDirection;
uniform float alphaCutoff;
uniform bool useSolid;
uniform vec4 solid;
uniform float opacity;
uniform bool fadesColour;
uniform bool writesOpaque;
uniform vec4 untextured;
uniform vec3 materialAmbient;
uniform vec3 materialDiffuse;
uniform vec3 materialEmissive;
uniform float materialAlpha;
uniform bool unlit;
uniform bool modulate2x;
uniform bool ambientFromVertex;
uniform bool diffuseFromVertex;
uniform bool vertexIsLit;
uniform bool vertexMultiplies;
uniform vec3 vertexScale;
uniform float vertexAlphaScale;
const float SCENE_AMBIENT = 0.35;
const float SCENE_LIGHT = 0.65;
vec3 shade(vec3 vertexColour) {
  vec3 ambient = ambientFromVertex ? vertexColour : materialAmbient;
  vec3 diffuse = diffuseFromVertex ? vertexColour : materialDiffuse;
  float light = hasNormals ? abs(dot(normalize(vNormal), lightDirection)) : 1.0;
  if (unlit) return vec3(1.0) + materialEmissive;
  if (vertexIsLit) return diffuse;
  return clamp(
    SCENE_AMBIENT * ambient + SCENE_LIGHT * light * diffuse + materialEmissive,
    0.0,
    1.0
  );
}
void main() {
  if (useSolid) { gl_FragColor = solid; return; }
  vec3 vertexColour = vColor.rgb * vertexScale;
  bool alphaFromVertex = diffuseFromVertex || vertexMultiplies;
  vec4 base = hasTexture ? texture2D(tex, vUv) : untextured;
  base.a *= materialAlpha * (alphaFromVertex ? vColor.a * vertexAlphaScale : 1.0);
  if (base.a < alphaCutoff) discard;
  vec3 lit = shade(vertexColour);
  vec3 shaded = modulate2x
    ? clamp(base.rgb * clamp(lit, 0.0, 1.0) * 2.0, 0.0, 1.0)
    : base.rgb * lit;
  if (vertexMultiplies) shaded *= vertexColour;
  if (writesOpaque) gl_FragColor = vec4(shaded, 1.0);
  else if (fadesColour) gl_FragColor = vec4(shaded * opacity, base.a);
  else gl_FragColor = vec4(shaded, base.a * opacity);
}`;
