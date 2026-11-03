import type { ModelScene } from "../../formats/w3d/w3dScene";

const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

/**
 * Uploads a scene's textures, mipmapped and repeating where they are a power
 * of two and not clamped, else clamped to the edge. Returns them by the index
 * the scene's draws use.
 */
export const uploadTextures = (
  gl: WebGLRenderingContext,
  { textures, addressing }: Pick<ModelScene, "textures" | "addressing">,
): WebGLTexture[] =>
  textures.map(({ width, height, pixels }, at) => {
    const texture = gl.createTexture()!;
    const tiles = isPowerOfTwo(width) && isPowerOfTwo(height);
    const clamp = addressing?.[at];
    const wrapOf = (clamped?: boolean) => (tiles && !clamped ? gl.REPEAT : gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    );
    if (tiles) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      tiles ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapOf(clamp?.clampU));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapOf(clamp?.clampV));
    return texture;
  });
