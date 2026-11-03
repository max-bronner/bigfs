/**
 * Points a float attribute at a buffer, or switches it off when there is none.
 * A negative location is an attribute the program has dropped.
 */
export const bindAttribute = (
  gl: WebGLRenderingContext,
  location: number,
  data: WebGLBuffer | undefined,
  size: number,
): void => {
  if (location < 0) {
    return;
  }
  if (!data) {
    gl.disableVertexAttribArray(location);
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, data);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
};
