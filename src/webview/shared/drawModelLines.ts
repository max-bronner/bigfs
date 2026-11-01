import { bindAttribute } from "./bindAttribute";
import { bindColors } from "./bindColors";
import type { ModelLocations } from "./modelLocations";

const BOX_COLOUR = [0.3, 0.9, 0.5, 1];
const BONE_COLOUR = [1, 0.75, 0.2, 1];

/** Collision boxes already uploaded: line endpoints in a buffer */
export interface BoxLines {
  buffer: WebGLBuffer;
  vertexCount: number;
}

/** Bone lines to upload each frame: three floats an endpoint, drawn into `buffer` */
export interface BoneLines {
  buffer: WebGLBuffer;
  vertices: number[];
}

/** Points every attribute but the position at nothing, as a flat colour needs */
const bindSolid = (
  gl: WebGLRenderingContext,
  { uniform, attributes }: ModelLocations,
  colour: number[],
  positions: WebGLBuffer,
) => {
  gl.uniform1i(uniform("useSolid"), 1);
  gl.uniform4fv(uniform("solid"), colour);
  bindAttribute(gl, attributes.normal, undefined, 3);
  bindAttribute(gl, attributes.uv, undefined, 2);
  bindAttribute(gl, attributes.detailUv, undefined, 2);
  bindColors(gl, attributes.color, undefined);
  bindAttribute(gl, attributes.position, positions, 3);
};

/**
 * Draws the collision boxes as green wireframes in the depth buffer, then the
 * bones as orange lines and points over everything. The caller has set the
 * program, and sets the solid flag back for the draws after.
 */
export const drawModelLines = (
  gl: WebGLRenderingContext,
  locations: ModelLocations,
  boxes: BoxLines | undefined,
  bones: BoneLines | undefined,
): void => {
  if (boxes?.vertexCount) {
    bindSolid(gl, locations, BOX_COLOUR, boxes.buffer);
    gl.drawArrays(gl.LINES, 0, boxes.vertexCount);
  }
  if (bones?.vertices.length) {
    gl.disable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, bones.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bones.vertices), gl.DYNAMIC_DRAW);
    bindSolid(gl, locations, BONE_COLOUR, bones.buffer);
    gl.drawArrays(gl.LINES, 0, bones.vertices.length / 3);
    gl.drawArrays(gl.POINTS, 0, bones.vertices.length / 3);
    gl.enable(gl.DEPTH_TEST);
  }
};
