import { createModelRenderer } from '../shared/modelRenderer';
import type { ParticleDef } from '../../formats/particles/particleIni';
import type { Particle } from '../../formats/particles/particleSimulation';
import type { Basis } from './camera';
import { dot } from './camera';
import { $, library, world } from './page';

/**
 * WebGL drawing: particles as camera-facing billboards with the game's
 * four blend states, and coloured lines for the grid and volumes. Without
 * WebGL the simulation still runs and reports; only drawing stops.
 */

/** Floats per billboard vertex: position, corner, size, angle, colour and flipbook rect */
const FLOATS = 15;
/** Billboards per draw call, so their four vertices each stay within 16-bit indices */
const CHUNK = 16000;

const SPRITE_VERTEX = `
attribute vec3 aPos; attribute vec2 aCorner; attribute float aSize; attribute float aAngle; attribute vec4 aColor; attribute vec4 aUv;
uniform mat4 uViewProj; uniform vec3 uRight; uniform vec3 uUp;
varying vec4 vColor; varying vec2 vUv;
void main() {
  float c = cos(aAngle); float s = sin(aAngle);
  vec2 r = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);
  vec3 world = aPos + (uRight * r.x + uUp * r.y) * aSize;
  gl_Position = uViewProj * vec4(world, 1.0);
  vColor = aColor;
  vUv = aUv.xy + vec2(aCorner.x + 0.5, 0.5 - aCorner.y) * aUv.zw;
}`;
const SPRITE_FRAGMENT = `
precision mediump float;
uniform sampler2D uTexture; uniform float uAlphaTest;
varying vec4 vColor; varying vec2 vUv;
void main() {
  vec4 color = texture2D(uTexture, vUv) * vColor;
  if (uAlphaTest > 0.5 && color.a < 0.5) discard;
  gl_FragColor = color;
}`;
const LINE_VERTEX = `
attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uViewProj; varying vec4 vColor;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vColor = aColor; }`;
const LINE_FRAGMENT = `
precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;

/** Canvas the particle preview draws on */
export const canvas = $<HTMLCanvasElement>('canvas');

const gl = canvas.getContext('webgl', {
  antialias: true,
  premultipliedAlpha: false,
});

const setUp = (gl: WebGLRenderingContext) => {
  const compile = (vertex: string, fragment: string) => {
    const program = gl.createProgram()!;

    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)!;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    return program;
  };
  const texture = (upload: () => void, magFilter = true) => {
    const handle = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    if (magFilter) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    upload();
    return handle;
  };
  const indices = new Uint16Array(CHUNK * 6);

  for (let i = 0; i < CHUNK; i++) {
    indices.set(
      [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3],
      i * 6,
    );
  }

  const indexBuffer = gl.createBuffer()!;

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const spriteData = new Float32Array(CHUNK * 4 * FLOATS);
  const spriteBuffer = gl.createBuffer()!;

  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW);

  // The stand-in for a texture no archive supplies: a soft white dot,
  // white scaled by its own alpha so additive draws a dot too
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = Math.max(0, 1 - d);
      const v = Math.round(a * a * 255);

      pixels.set([v, v, v, v], (y * size + x) * 4);
    }
  }

  return {
    spriteProgram: compile(SPRITE_VERTEX, SPRITE_FRAGMENT),
    lineProgram: compile(LINE_VERTEX, LINE_FRAGMENT),
    model: createModelRenderer(gl),
    spriteBuffer,
    spriteData,
    indexBuffer,
    lineBuffer: gl.createBuffer()!,
    makeTexture: (source: TexImageSource) =>
      texture(() =>
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        ),
      ),
    fallbackTexture: texture(
      () =>
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          size,
          size,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        ),
      false,
    ),
  };
};

const graphics = (() => {
  if (!gl) {
    return undefined;
  }
  try {
    return { gl, ...setUp(gl) };
  } catch (error) {
    console.error(error);
    return undefined;
  }
})();

/** Whether WebGL is available and its programs compiled; without it the simulation still runs */
export const hasGraphics = graphics !== undefined;

const textures = new Map<string, WebGLTexture>();

/** Starts loading textures not loaded yet; the dot stands in meanwhile */
export const loadTextures = (sources: Record<string, string | null>): void => {
  if (!graphics) {
    return;
  }
  for (const [name, uri] of Object.entries(sources)) {
    if (textures.has(name) || !uri) {
      continue;
    }
    textures.set(name, graphics.fallbackTexture);

    const image = new Image();

    image.onload = () => textures.set(name, graphics.makeTexture(image));
    image.src = uri;
  }
};

/** The model the effect is shown on, drawn as the W3D viewer draws it */
export const model = graphics?.model;

/** Draws line vertices, xyz rgba each; without `depthTest` they show through everything */
export const drawLines = (
  lines: number[],
  matrix: Float32Array,
  depthTest: boolean,
): void => {
  if (!graphics || !lines.length) {
    return;
  }

  const { gl, lineProgram, lineBuffer } = graphics;

  gl.useProgram(lineProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

  const position = gl.getAttribLocation(lineProgram, 'aPos');
  const color = gl.getAttribLocation(lineProgram, 'aColor');

  gl.enableVertexAttribArray(position);
  gl.enableVertexAttribArray(color);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 28, 0);
  gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 28, 12);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(lineProgram, 'uViewProj'),
    false,
    matrix,
  );
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

/**
 * Counts of the last frame drawn: billboards, and their summed screen area as
 * a multiple of the view's (fill, the overdraw a GPU pays for at this view)
 */
export const drawStats = { drawn: 0, fill: 0 };

/** Blend state setters by particle shader name; each returns 1 when the shader alpha-tests */
const BLENDS: Record<string, (gl: WebGLRenderingContext) => number> = {
  ADDITIVE: (gl) => {
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    return 0;
  },
  ALPHA: (gl) => {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    return 0;
  },
  ALPHA_TEST: (gl) => {
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.depthMask(true);
    return 1;
  },
  MULTIPLY: (gl) => {
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.depthMask(false);
    return 0;
  },
};

/** Computes the flipbook cell a particle shows: its own first cell plus age times speed */
const cellUv = (
  book: ParticleDef['flipbook'],
  particle: Particle,
  blend: number,
): [number, number, number, number] => {
  if (!book) {
    return [0, 0, 1, 1];
  }

  const perRow = Math.max(1, book.framesPerRow);
  const total = Math.max(1, book.totalFrames);
  const rows = Math.max(1, Math.ceil(total / perRow));
  const age = Math.max(0, particle.age - 1 + blend);
  const cell =
    Math.floor((particle.sheetStart % total) + age * book.speed) % total;

  return [
    (cell % perRow) / perRow,
    (Math.floor(cell / perRow) % rows) / rows,
    1 / perRow,
    1 / rows,
  ];
};

const CORNERS = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/** Draws every live system back to front, `blend` of the way to the next step */
export const drawSystems = (
  matrix: Float32Array,
  basis: Basis,
  blend: number,
  colourKeys: boolean,
): void => {
  if (!graphics) {
    return;
  }

  let covered = 0;
  let drawn = 0;
  const { gl, spriteProgram, spriteBuffer, spriteData, indexBuffer } = graphics;
  const order = world.systems
    .map((system) => {
      const d = system.origin.map(
        (o, i) => o - basis.eye[i],
      ) as typeof basis.eye;

      return {
        system,
        def: library.systems.get(system.name.toLowerCase()),
        distance: dot(d, d),
      };
    })
    .filter((entry) => entry.def && entry.system.particles.length)
    .sort((a, b) => b.distance - a.distance);

  gl.useProgram(spriteProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  const attributes = (
    [
      ['aPos', 3, 0],
      ['aCorner', 2, 3],
      ['aSize', 1, 5],
      ['aAngle', 1, 6],
      ['aColor', 4, 7],
      ['aUv', 4, 11],
    ] as const
  ).map(([name, size, offset]) => {
    const location = gl.getAttribLocation(spriteProgram, name);

    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(
      location,
      size,
      gl.FLOAT,
      false,
      FLOATS * 4,
      offset * 4,
    );
    return location;
  });
  const uniform = (name: string) => gl.getUniformLocation(spriteProgram, name);

  gl.uniformMatrix4fv(uniform('uViewProj'), false, matrix);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);

  for (const { system, def } of order) {
    const marker = def!.type === 'DRAWABLE';
    const flat = def!.groundAligned;

    gl.uniform3fv(uniform('uRight'), flat ? [-2, 0, 0] : basis.right);
    gl.uniform3fv(uniform('uUp'), flat ? [0, 2, 0] : basis.up);
    gl.uniform1f(
      uniform('uAlphaTest'),
      (BLENDS[def!.shader] ?? BLENDS.ADDITIVE)(gl),
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      gl.TEXTURE_2D,
      (!marker &&
        def!.particleName &&
        textures.get(def!.particleName.toLowerCase())) ||
        graphics.fallbackTexture,
    );
    gl.uniform1i(uniform('uTexture'), 0);

    const readsAlpha = def!.shader !== 'ADDITIVE';
    const particles = system.particles.slice(
      0,
      world.options.batchLimit ? 512 : undefined,
    );

    drawn += particles.length;
    for (let first = 0; first < particles.length; first += CHUNK) {
      const batch = particles.slice(first, first + CHUNK);

      batch.forEach((p, i) => {
        const position = p.previous.map(
          (v, k) => v + (p.position[k] - v) * blend,
        );
        const size = marker
          ? 6
          : p.previousSize + (p.size - p.previousSize) * blend;
        const angle = p.previousAngle + (p.angle - p.previousAngle) * blend;
        // Depth from the clip w: the screen size of a billboard falls off with it
        const depth =
          matrix[3] * position[0] +
          matrix[7] * position[1] +
          matrix[11] * position[2] +
          matrix[15];

        if (depth > 0.001) {
          const pixels =
            (Math.max(0, size) * matrix[5] * canvas.height) / 2 / depth;

          covered += pixels * pixels;
        }
        const color = colourKeys
          ? p.previousColor.map((v, k) => v + (p.color[k] - v) * blend)
          : [1, 1, 1];
        const alpha =
          !colourKeys || !readsAlpha
            ? 1
            : p.previousAlpha + (p.alpha - p.previousAlpha) * blend;
        const uv = cellUv(def!.flipbook, p, blend);

        CORNERS.forEach((corner, c) => {
          spriteData.set(
            [
              position[0],
              position[1],
              position[2],
              corner[0],
              corner[1],
              Math.max(0, size),
              angle,
              color[0],
              color[1],
              color[2],
              marker ? 1 : alpha,
              ...uv,
            ],
            (i * 4 + c) * FLOATS,
          );
        });
      });
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        spriteData.subarray(0, batch.length * 4 * FLOATS),
      );
      gl.drawElements(gl.TRIANGLES, batch.length * 6, gl.UNSIGNED_SHORT, 0);
    }
  }
  attributes.forEach((location) => gl.disableVertexAttribArray(location));
  gl.depthMask(true);
  drawStats.drawn = drawn;
  drawStats.fill = covered / Math.max(1, canvas.width * canvas.height);
};

/** Sizes the canvas to its box and clears it to the sky */
export const beginFrame = (sky: string): void => {
  if (!graphics) {
    return;
  }

  const { gl } = graphics;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(
    parseInt(sky.slice(1, 3), 16) / 255,
    parseInt(sky.slice(3, 5), 16) / 255,
    parseInt(sky.slice(5, 7), 16) / 255,
    1,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
};
