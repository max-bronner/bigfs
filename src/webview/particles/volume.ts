import type { ParticleDef, Vec3 } from '../../formats/particles/particleIni';

/** Lines for the ground grid and emitter volumes: xyz rgba per vertex */

type Color = [number, number, number, number];

/** Appends a line's two vertices, xyz rgba each */
export const pushLine = (
  out: number[],
  a: Vec3,
  b: Vec3,
  color: Color,
): void => {
  out.push(...a, ...color, ...b, ...color);
};

/** Appends a circle flat on the ground around a point */
export const pushRing = (
  out: number[],
  center: Vec3,
  radius: number,
  color: Color,
): void => {
  const SEGMENTS = 32;

  for (let step = 0; step < SEGMENTS; step++) {
    const point = (index: number): Vec3 => [
      center[0] + Math.cos((index / SEGMENTS) * Math.PI * 2) * radius,
      center[1] + Math.sin((index / SEGMENTS) * Math.PI * 2) * radius,
      center[2],
    ];

    pushLine(out, point(step), point(step + 1), color);
  }
};

/** Estimates a rough size for the camera to frame a system */
export const reach = (def: ParticleDef | undefined): number => {
  if (!def) {
    return 100;
  }

  const volume = def.volume;
  const extent =
    volume.type === 'sphere'
      ? volume.radius
      : volume.type === 'cylinder'
        ? volume.radius + volume.length
        : volume.type === 'box'
          ? Math.max(...volume.halfSize.map(Math.abs))
          : volume.type === 'line'
            ? Math.hypot(
                ...volume.end.map((end, axis) => end - volume.start[axis]),
              )
            : 0;

  return Math.max(
    40,
    extent * 2 + Math.max(Math.abs(def.size.low), Math.abs(def.size.high)) * 3,
  );
};

/** Appends the outline of a system's emitter volume and a small axis cross at its origin */
export const volumeLines = (
  out: number[],
  def: ParticleDef,
  origin: Vec3,
  color: Color = [1, 0.8, 0.2, 0.9],
): void => {
  const volume = def.volume;
  const at = (p: Vec3): Vec3 => [
    p[0] + origin[0],
    p[1] + origin[1],
    p[2] + origin[2],
  ];
  const ring = (point: (angle: number) => Vec3, segments = 32) => {
    for (let index = 0; index < segments; index++) {
      pushLine(
        out,
        at(point((index / segments) * Math.PI * 2)),
        at(point(((index + 1) / segments) * Math.PI * 2)),
        color,
      );
    }
  };

  if (volume.type === 'line') {
    pushLine(out, at(volume.start), at(volume.end), color);
  } else if (volume.type === 'box') {
    const [x, y, z] = volume.halfSize;
    const corners = [-1, 1].flatMap((i) =>
      [-1, 1].flatMap((j) => [-1, 1].map((k): Vec3 => [i * x, j * y, k * z])),
    );

    for (let a = 0; a < 8; a++) {
      for (let b = a + 1; b < 8; b++) {
        const differ = [0, 1, 2].filter(
          (axis) => corners[a][axis] !== corners[b][axis],
        ).length;

        if (differ === 1) {
          pushLine(out, at(corners[a]), at(corners[b]), color);
        }
      }
    }
  } else if (volume.type === 'sphere') {
    const r = volume.radius;

    ring((a) => [Math.cos(a) * r, Math.sin(a) * r, 0]);
    ring((a) => [Math.cos(a) * r, 0, Math.sin(a) * r]);
    ring((a) => [0, Math.cos(a) * r, Math.sin(a) * r]);
  } else if (volume.type === 'cylinder') {
    const [ox, oy, oz] = volume.offset;
    const r = volume.radius;
    const half = volume.length / 2;

    ring((a) => [ox + Math.cos(a) * r, oy + Math.sin(a) * r, oz - half]);
    ring((a) => [ox + Math.cos(a) * r, oy + Math.sin(a) * r, oz + half]);
    for (let index = 0; index < 4; index++) {
      const a = (index / 4) * Math.PI * 2;

      pushLine(
        out,
        at([ox + Math.cos(a) * r, oy + Math.sin(a) * r, oz - half]),
        at([ox + Math.cos(a) * r, oy + Math.sin(a) * r, oz + half]),
        color,
      );
    }
  }

  const s = 4;

  pushLine(out, at([-s, 0, 0]), at([s, 0, 0]), color);
  pushLine(out, at([0, -s, 0]), at([0, s, 0]), color);
  pushLine(out, at([0, 0, -s]), at([0, 0, s]), color);
};

/** Line vertices of the ground grid and the red, green and blue axes */
export const GRID: number[] = (() => {
  const out: number[] = [];
  const color: Color = [1, 1, 1, 0.12];

  for (let i = -200; i <= 200; i += 20) {
    pushLine(out, [i, -200, 0], [i, 200, 0], color);
    pushLine(out, [-200, i, 0], [200, i, 0], color);
  }
  pushLine(out, [0, 0, 0], [40, 0, 0], [1, 0.3, 0.3, 0.8]);
  pushLine(out, [0, 0, 0], [0, 40, 0], [0.3, 1, 0.3, 0.8]);
  pushLine(out, [0, 0, 0], [0, 0, 40], [0.4, 0.6, 1, 0.8]);
  return out;
})();
