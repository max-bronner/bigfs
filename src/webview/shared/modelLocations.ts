/** Finds a uniform of the model program by name; null where the program has dropped it */
export type UniformLookup = (name: string) => WebGLUniformLocation | null;

/** The attribute locations of the model program, negative where the program has dropped one */
export interface ModelAttributes {
  position: number;
  normal: number;
  uv: number;
  detailUv: number;
  color: number;
}

/** Where the model program keeps the things its draws set */
export interface ModelLocations {
  uniform: UniformLookup;
  attributes: ModelAttributes;
}
