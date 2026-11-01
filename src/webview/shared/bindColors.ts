/**
 * Points the colour attribute at a buffer of normalised bytes, or at opaque
 * white when there is none.
 */
export const bindColors = (
  gl: WebGLRenderingContext,
  location: number,
  data: WebGLBuffer | undefined,
): void => {
  if (location < 0) {
    return;
  }
  if (!data) {
    gl.disableVertexAttribArray(location);
    gl.vertexAttrib4f(location, 1, 1, 1, 1);
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, data);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 4, gl.UNSIGNED_BYTE, true, 0, 0);
};
