/**
 * The GLSL of the model renderer. The fragment shader composes what a W3D
 * material asks for in the order the engine does: the two texture
 * stages, then the material's lit colour, as `w3d-shading.md` lays out and mint's
 * `shader.wgsl` draws it. WebGL 1.
 */

/** Vertex shader of the model renderer */
export const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 detailUv;
attribute vec4 color;
uniform mat4 viewProjection;
uniform vec3 offset;
uniform vec3 eye;
uniform mat3 viewRotation;
uniform vec4 uvLinear;
uniform vec2 uvOffset;
uniform int uvGenerated;
uniform vec4 detailUvLinear;
uniform vec2 detailUvOffset;
uniform int detailUvGenerated;
varying vec3 vNormal;
varying vec2 vUv;
varying vec2 vDetailUv;
varying vec4 vColor;
varying vec3 vPosition;
varying vec3 vToEye;
// The environment mappers of w3d-format.md: a normal or reflection vector read
// as a coordinate, in camera space or, for the WS ones, in world space
vec2 generateUv(int mapper, vec2 stored) {
  if (mapper != 1 && mapper != 2 && mapper != 12 && mapper != 13) return stored;
  vec3 unit = normalize(normal);
  vec3 reflection = reflect(normalize(position + offset - eye), unit);
  if (mapper == 2) return (viewRotation * unit).xy * 0.5 + 0.5;
  if (mapper == 1) return (viewRotation * reflection).xy * 0.25 + 0.5;
  if (mapper == 12) return unit.xy * 0.5 + 0.5;
  return reflection.xy * 0.25 + 0.5;
}
vec2 transformUv(vec2 at, vec4 linear, vec2 shift) {
  return vec2(linear.x * at.x + linear.y * at.y, linear.z * at.x + linear.w * at.y) + shift;
}
void main() {
  vNormal = normal;
  vUv = transformUv(generateUv(uvGenerated, uv), uvLinear, uvOffset);
  vDetailUv = transformUv(generateUv(detailUvGenerated, detailUv), detailUvLinear, detailUvOffset);
  vColor = color;
  vPosition = position + offset;
  vToEye = eye - vPosition;
  gl_Position = viewProjection * vec4(position + offset, 1.0);
}`;

/** Fragment shader of the model renderer, past what depends on the context */
const FRAGMENT_BODY = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vToEye;
varying vec2 vUv;
varying vec2 vDetailUv;
varying vec4 vColor;
uniform sampler2D tex;
uniform sampler2D detailTex;
uniform bool hasTexture;
uniform bool hasDetail;
uniform int detailColor;
uniform int detailAlpha;
uniform bool bumpOffset;
uniform vec4 bumpMatrix;
uniform sampler2D houseMaskTex;
uniform bool hasHouseMask;
uniform vec3 houseColour;
uniform sampler2D normalTex;
uniform bool hasNormalMap;
uniform float bumpScale;
uniform vec3 specularColour;
uniform float shininess;
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
vec3 combineColour(vec3 local, vec3 other, float localAlpha, float otherAlpha) {
  if (detailColor == 1) return other;
  if (detailColor == 2) return local * other;
  if (detailColor == 3) return local + (vec3(1.0) - local) * other;
  if (detailColor == 4) return local + other;
  if (detailColor == 5) return local - other;
  if (detailColor == 6) return other - local;
  if (detailColor == 7) return mix(other, local, localAlpha);
  if (detailColor == 8) return mix(other, local, otherAlpha);
  if (detailColor == 9) return clamp(local + other - vec3(0.5), 0.0, 1.0);
  if (detailColor == 10) return clamp((local + other - vec3(0.5)) * 2.0, 0.0, 1.0);
  if (detailColor == 11) return clamp(2.0 * local * other, 0.0, 1.0);
  if (detailColor == 12) return clamp(local + localAlpha * other, 0.0, 1.0);
  return local;
}
float combineAlpha(float local, float other) {
  if (detailAlpha == 1) return other;
  if (detailAlpha == 2) return local * other;
  if (detailAlpha == 3) return local + (1.0 - local) * other;
  return local;
}
// The surface's basis from how position and UV change across the pixel, which
// holds on a posed mesh with no tangents to skin; the V of vUv runs as mint's
// bitangent does. Without the extension the mesh stays smooth.
vec3 applyNormalMap(vec3 unit) {
#ifdef GL_OES_standard_derivatives
  vec3 positionX = dFdx(vPosition);
  vec3 positionY = dFdy(vPosition);
  vec2 uvX = dFdx(vUv);
  vec2 uvY = dFdy(vUv);
  vec3 acrossY = cross(positionY, unit);
  vec3 acrossX = cross(unit, positionX);
  vec3 tangent = acrossY * uvX.x + acrossX * uvY.x;
  vec3 bitangent = acrossY * uvX.y + acrossX * uvY.y;
  float size = max(dot(tangent, tangent), dot(bitangent, bitangent));
  if (size > 0.0) {
    vec3 mapped = texture2D(normalTex, vUv).xyz * 2.0 - 1.0;
    vec3 tilt = (mapped.x * tangent + mapped.y * bitangent) * bumpScale / sqrt(size);
    return normalize(tilt + mapped.z * unit);
  }
#endif
  return unit;
}
vec3 findNormal() {
  vec3 unit = normalize(vNormal);
  if (dot(unit, lightDirection) < 0.0) unit = -unit;
  return hasNormalMap ? applyNormalMap(unit) : unit;
}
vec3 shade(vec3 vertexColour, vec3 unit) {
  vec3 ambient = ambientFromVertex ? vertexColour : materialAmbient;
  vec3 diffuse = diffuseFromVertex ? vertexColour : materialDiffuse;
  float light = hasNormals ? max(dot(unit, lightDirection), 0.0) : 1.0;
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
  vec4 texel = hasTexture ? texture2D(tex, vUv) : untextured;
  vec4 base = bumpOffset ? vec4(1.0) : texel;
  base.a *= materialAlpha * (alphaFromVertex ? vColor.a * vertexAlphaScale : 1.0);
  if (hasDetail) {
    vec2 slope = (texel.rg * 255.0 - 128.0) / 127.0;
    vec2 shift = bumpOffset ? slope.x * bumpMatrix.xy + slope.y * bumpMatrix.zw : vec2(0.0);
    vec4 detail = texture2D(detailTex, vDetailUv + shift);
    base = vec4(
      combineColour(base.rgb, detail.rgb, base.a, detail.a),
      combineAlpha(base.a, detail.a)
    );
  }
  if (base.a < alphaCutoff) discard;
  vec3 unit = hasNormals ? findNormal() : vec3(0.0);
  vec3 lit = shade(vertexColour, unit);
  vec3 shaded = modulate2x
    ? clamp(base.rgb * clamp(lit, 0.0, 1.0) * 2.0, 0.0, 1.0)
    : base.rgb * lit;
  if (vertexMultiplies) shaded *= vertexColour;
  if (hasNormals && dot(unit, lightDirection) > 0.0) {
    vec3 halfway = normalize(lightDirection + normalize(vToEye));
    shaded += specularColour * SCENE_LIGHT * pow(max(dot(unit, halfway), 0.0), shininess);
  }
  if (hasHouseMask) {
    vec4 mask = texture2D(houseMaskTex, vUv);
    shaded = mix(shaded, mask.r * houseColour, mask.a);
  }
  if (writesOpaque) gl_FragColor = vec4(shaded, 1.0);
  else if (fadesColour) gl_FragColor = vec4(shaded * opacity, base.a);
  else gl_FragColor = vec4(shaded, base.a * opacity);
}`;

/** Builds the fragment shader for a context with or without `OES_standard_derivatives` */
export const buildFragmentShader = (hasDerivatives: boolean): string =>
  `${hasDerivatives ? "#extension GL_OES_standard_derivatives : enable" : ""}${FRAGMENT_BODY}`;
