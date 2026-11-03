const LINE_VERTEX = `
attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uViewProj; varying vec4 vColor;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vColor = aColor; }`;
const LINE_FRAGMENT = `
precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;
/** Bytes of one line vertex: xyz rgba as floats */
const STRIDE = 28;

/** Draws line vertices, xyz rgba each; without `depthTest` they show through everything */
export type DrawLines = (
  lines: number[],
  matrix: Float32Array,
  depthTest: boolean,
) => void;

const compile = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)!;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  }
  return shader;
};

/** Creates the line drawing the viewer's grid and a context's volumes share, on a context other programs may use */
export const createLineRenderer = (gl: WebGLRenderingContext): DrawLines => {
  const program = gl.createProgram()!;
  const buffer = gl.createBuffer()!;

  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, LINE_VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, LINE_FRAGMENT));
  gl.linkProgram(program);

  return (lines, matrix, depthTest) => {
    if (!lines.length) {
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

    const position = gl.getAttribLocation(program, 'aPos');
    const color = gl.getAttribLocation(program, 'aColor');

    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(color, 4, gl.FLOAT, false, STRIDE, 12);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uViewProj'), false, matrix);
    if (depthTest) {
      gl.enable(gl.DEPTH_TEST);
    } else {
      gl.disable(gl.DEPTH_TEST);
    }
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, lines.length / 7);
    gl.disableVertexAttribArray(position);
    gl.disableVertexAttribArray(color);
  };
};
