/**
 * Page code of the particle preview: runs `BigfsParticles.ParticleWorld` at
 * 30 Hz, draws its particles as billboards in WebGL with the game's four
 * blend states, and turns every number of the previewed block into a slider.
 * The extension owns the definitions; the page sends slider values and gets
 * the scene back.
 */
export const PARTICLE_VIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const { ParticleWorld, STEP_HZ } = BigfsParticles;
const canvas = document.getElementById('canvas');
const hud = document.getElementById('hud');
const $ = (id) => document.getElementById(id);
const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false });

const state = {
  scene: undefined,
  playing: true,
  speed: 1,
  accumulator: 0,
  idle: 0,
  roots: [],
  yaw: -0.8, pitch: 0.45, distance: 220, target: [0, 0, 20],
  time: 0,
};
let systems = new Map();
let fxLists = new Map();
const world = new ParticleWorld({
  system: (name) => systems.get(name.toLowerCase()),
  fxList: (name) => fxLists.get(name.toLowerCase()),
}, 7);

// ---- WebGL -------------------------------------------------------------
// Without WebGL the simulation still runs and reports; only drawing stops
const FLOATS = 15;
const CHUNK = 16000;
const textures = new Map();
const graphics = (() => {
  if (!gl) return undefined;
  try {
    const compile = (vertex, fragment) => {
      const program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      return program;
    };

    const spriteProgram = compile([
      'attribute vec3 aPos; attribute vec2 aCorner; attribute float aSize; attribute float aAngle; attribute vec4 aColor; attribute vec4 aUv;',
      'uniform mat4 uViewProj; uniform vec3 uRight; uniform vec3 uUp;',
      'varying vec4 vColor; varying vec2 vUv;',
      'void main() {',
      '  float c = cos(aAngle); float s = sin(aAngle);',
      '  vec2 r = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);',
      '  vec3 world = aPos + (uRight * r.x + uUp * r.y) * aSize;',
      '  gl_Position = uViewProj * vec4(world, 1.0);',
      '  vColor = aColor;',
      '  vUv = aUv.xy + vec2(aCorner.x + 0.5, 0.5 - aCorner.y) * aUv.zw;',
      '}'].join(' '), [
      'precision mediump float;',
      'uniform sampler2D uTexture; uniform float uAlphaTest;',
      'varying vec4 vColor; varying vec2 vUv;',
      'void main() {',
      '  vec4 color = texture2D(uTexture, vUv) * vColor;',
      '  if (uAlphaTest > 0.5 && color.a < 0.5) discard;',
      '  gl_FragColor = color;',
      '}'].join(' '));

    const lineProgram = compile([
      'attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uViewProj; varying vec4 vColor;',
      'void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vColor = aColor; }'].join(' '),
      'precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }');

    const spriteBuffer = gl.createBuffer();
    const spriteData = new Float32Array(CHUNK * 4 * FLOATS);
    const indexBuffer = gl.createBuffer();
    {
      const indices = new Uint16Array(CHUNK * 6);
      for (let i = 0; i < CHUNK; i++) indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW);
    const lineBuffer = gl.createBuffer();

    const makeTexture = (source) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return texture;
    };
    /** The stand-in for a texture no archive supplies: a soft white dot */
    const fallbackTexture = (() => {
      const size = 64;
      const pixels = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
        const a = Math.max(0, 1 - d);
        const v = Math.round(a * a * 255);
        // White scaled by its own alpha, so additive draws a dot too
        pixels.set([v, v, v, v], (y * size + x) * 4);
      }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return texture;
    })();
    return { spriteProgram, lineProgram, spriteBuffer, spriteData, indexBuffer, lineBuffer, makeTexture, fallbackTexture };
  } catch (error) {
    console.error(error);
    return undefined;
  }
})();
const { spriteProgram, lineProgram, spriteBuffer, spriteData, indexBuffer, lineBuffer, makeTexture, fallbackTexture } = graphics || {};
if (!graphics) {
  document.getElementById('hud').textContent = 'WebGL is not available here, so nothing is drawn; the simulation still runs.';
}

const loadTextures = (sources) => {
  if (!graphics) return;
  for (const [name, uri] of Object.entries(sources)) {
    if (textures.has(name) || !uri) continue;
    textures.set(name, fallbackTexture);
    const image = new Image();
    image.onload = () => textures.set(name, makeTexture(image));
    image.src = uri;
  }
};

// ---- Camera ------------------------------------------------------------
const cameraBasis = () => {
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
  const forward = [Math.cos(state.yaw) * cp, Math.sin(state.yaw) * cp, -sp];
  const eye = state.target.map((t, i) => t - forward[i] * state.distance);
  const right = normalize(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  return { eye, forward, right, up };
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const viewProjection = ({ eye, forward, right, up }) => {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const near = 1, far = 20000, f = 1 / Math.tan(0.45);
  // Column-major view (rows right, up, -forward) times perspective
  const view = [right[0], up[0], -forward[0], 0, right[1], up[1], -forward[1], 0, right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1];
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += projection[k * 4 + r] * view[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
};

let drag;
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => { drag = { x: event.clientX, y: event.clientY, pan: event.button !== 0 }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', () => { drag = undefined; });
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.x = event.clientX; drag.y = event.clientY;
  if (drag.pan) {
    const { right, up } = cameraBasis();
    const k = state.distance / 600;
    state.target = state.target.map((t, i) => t - right[i] * dx * k + up[i] * dy * k);
  } else {
    state.yaw -= dx * 0.008;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.008));
  }
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.distance = Math.max(5, Math.min(8000, state.distance * Math.exp(event.deltaY * 0.001)));
}, { passive: false });

// ---- Scene -------------------------------------------------------------
const rootOrigin = () => {
  const motion = $('motion').value;
  const t = state.time;
  if (motion === 'circle') return [Math.cos(t * 1.5) * 60, Math.sin(t * 1.5) * 60, 0];
  if (motion === 'line') return [Math.sin(t * 1.2) * 80, 0, 0];
  return [0, 0, 0];
};
const start = () => {
  world.clear();
  state.time = 0;
  state.accumulator = 0;
  state.idle = 0;
  const scene = state.scene;
  if (!scene) return;
  const origin = rootOrigin();
  state.roots = scene.root.kind === 'fxList'
    ? world.fire(scene.root.name, origin)
    : [world.spawn(scene.root.name, origin)].filter((id) => id !== undefined);
};
/** A rough size for the camera to frame a system */
const reach = (def) => {
  if (!def) return 100;
  const v = def.volume;
  const extent = v.type === 'sphere' || v.type === 'cylinder' ? v.radius + (v.length || 0)
    : v.type === 'box' ? Math.max(...v.halfSize.map(Math.abs))
    : v.type === 'line' ? Math.hypot(...v.end.map((e, i) => e - v.start[i])) : 0;
  return Math.max(40, extent * 2 + Math.max(Math.abs(def.size.low), Math.abs(def.size.high)) * 3);
};

const pushLine = (out, a, b, color) => out.push(...a, ...color, ...b, ...color);
const volumeLines = (out, def, origin) => {
  const v = def.volume;
  const color = [1, 0.8, 0.2, 0.9];
  const at = (p) => [p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]];
  const circle = (radius, z, cx = 0, cy = 0) => {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, b = ((i + 1) / 32) * Math.PI * 2;
      pushLine(out, at([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z]), at([cx + Math.cos(b) * radius, cy + Math.sin(b) * radius, z]), color);
    }
  };
  if (v.type === 'line') pushLine(out, at(v.start), at(v.end), color);
  else if (v.type === 'box') {
    const [x, y, z] = v.halfSize;
    const corners = [-1, 1].flatMap((i) => [-1, 1].flatMap((j) => [-1, 1].map((k) => [i * x, j * y, k * z])));
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const differ = [0, 1, 2].filter((axis) => corners[a][axis] !== corners[b][axis]).length;
      if (differ === 1) pushLine(out, at(corners[a]), at(corners[b]), color);
    }
  } else if (v.type === 'sphere') {
    circle(v.radius, 0);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, b = ((i + 1) / 32) * Math.PI * 2;
      pushLine(out, at([Math.cos(a) * v.radius, 0, Math.sin(a) * v.radius]), at([Math.cos(b) * v.radius, 0, Math.sin(b) * v.radius]), color);
      pushLine(out, at([0, Math.cos(a) * v.radius, Math.sin(a) * v.radius]), at([0, Math.cos(b) * v.radius, Math.sin(b) * v.radius]), color);
    }
  } else if (v.type === 'cylinder') {
    const [ox, oy, oz] = v.offset;
    circle(v.radius, oz - v.length / 2, ox, oy);
    circle(v.radius, oz + v.length / 2, ox, oy);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      pushLine(out, at([ox + Math.cos(a) * v.radius, oy + Math.sin(a) * v.radius, oz - v.length / 2]), at([ox + Math.cos(a) * v.radius, oy + Math.sin(a) * v.radius, oz + v.length / 2]), color);
    }
  }
  const s = 4;
  pushLine(out, at([-s, 0, 0]), at([s, 0, 0]), color);
  pushLine(out, at([0, -s, 0]), at([0, s, 0]), color);
  pushLine(out, at([0, 0, -s]), at([0, 0, s]), color);
};

const drawLines = (lines, matrix, depthTest) => {
  if (!lines.length) return;
  gl.useProgram(lineProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
  const pos = gl.getAttribLocation(lineProgram, 'aPos');
  const color = gl.getAttribLocation(lineProgram, 'aColor');
  gl.enableVertexAttribArray(pos); gl.enableVertexAttribArray(color);
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 28, 0);
  gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 28, 12);
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'uViewProj'), false, matrix);
  if (depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.LINES, 0, lines.length / 7);
  gl.disableVertexAttribArray(pos); gl.disableVertexAttribArray(color);
};

const gridLines = () => {
  const out = [];
  const color = [1, 1, 1, 0.12];
  for (let i = -200; i <= 200; i += 20) {
    pushLine(out, [i, -200, 0], [i, 200, 0], color);
    pushLine(out, [-200, i, 0], [200, i, 0], color);
  }
  pushLine(out, [0, 0, 0], [40, 0, 0], [1, 0.3, 0.3, 0.8]);
  pushLine(out, [0, 0, 0], [0, 40, 0], [0.3, 1, 0.3, 0.8]);
  pushLine(out, [0, 0, 0], [0, 0, 40], [0.4, 0.6, 1, 0.8]);
  return out;
};
const GRID = gridLines();

const BLENDS = {
  ADDITIVE: () => { gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); return 0; },
  ALPHA: () => { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); return 0; },
  ALPHA_TEST: () => { gl.blendFunc(gl.ONE, gl.ZERO); gl.depthMask(true); return 1; },
  MULTIPLY: () => { gl.blendFunc(gl.ZERO, gl.SRC_COLOR); gl.depthMask(false); return 0; },
};

/** The flipbook cell a particle shows: its own first cell plus age times speed */
const cellUv = (book, particle, blend) => {
  if (!book) return [0, 0, 1, 1];
  const perRow = Math.max(1, book.framesPerRow);
  const total = Math.max(1, book.totalFrames);
  const rows = Math.max(1, Math.ceil(total / perRow));
  const age = Math.max(0, particle.age - 1 + blend);
  const cell = Math.floor((particle.sheetStart % total) + age * book.speed) % total;
  return [(cell % perRow) / perRow, (Math.floor(cell / perRow) % rows) / rows, 1 / perRow, 1 / rows];
};

const drawSystems = (matrix, basis, blend) => {
  const keys = $('keys').checked;
  const order = world.systems.map((system) => {
    const def = systems.get(system.name.toLowerCase());
    const d = system.origin.map((o, i) => o - basis.eye[i]);
    return { system, def, distance: dot(d, d) };
  }).filter((entry) => entry.def && entry.system.particles.length).sort((a, b) => b.distance - a.distance);

  gl.useProgram(spriteProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  const attributes = [['aPos', 3, 0], ['aCorner', 2, 3], ['aSize', 1, 5], ['aAngle', 1, 6], ['aColor', 4, 7], ['aUv', 4, 11]].map(([name, size, offset]) => {
    const location = gl.getAttribLocation(spriteProgram, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, FLOATS * 4, offset * 4);
    return location;
  });
  gl.uniformMatrix4fv(gl.getUniformLocation(spriteProgram, 'uViewProj'), false, matrix);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

  for (const { system, def } of order) {
    const marker = def.type === 'DRAWABLE';
    const flat = def.groundAligned;
    gl.uniform3fv(gl.getUniformLocation(spriteProgram, 'uRight'), flat ? [-2, 0, 0] : basis.right);
    gl.uniform3fv(gl.getUniformLocation(spriteProgram, 'uUp'), flat ? [0, 2, 0] : basis.up);
    const blendMode = BLENDS[def.shader] || BLENDS.ADDITIVE;
    gl.uniform1f(gl.getUniformLocation(spriteProgram, 'uAlphaTest'), blendMode());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (!marker && def.particleName && textures.get(def.particleName.toLowerCase())) || fallbackTexture);
    gl.uniform1i(gl.getUniformLocation(spriteProgram, 'uTexture'), 0);
    const readsAlpha = def.shader !== 'ADDITIVE';
    const particles = system.particles.slice(0, world.options.batchLimit ? 512 : undefined);
    for (let first = 0; first < particles.length; first += CHUNK) {
      const batch = particles.slice(first, first + CHUNK);
      batch.forEach((p, i) => {
        const pos = p.previous.map((v, k) => v + (p.position[k] - v) * blend);
        const size = marker ? 6 : p.previousSize + (p.size - p.previousSize) * blend;
        const angle = p.previousAngle + (p.angle - p.previousAngle) * blend;
        const color = keys ? p.previousColor.map((v, k) => v + (p.color[k] - v) * blend) : [1, 1, 1];
        const alpha = !keys || !readsAlpha ? 1 : p.previousAlpha + (p.alpha - p.previousAlpha) * blend;
        const uv = cellUv(def.flipbook, p, blend);
        corners.forEach((corner, c) => {
          spriteData.set([pos[0], pos[1], pos[2], corner[0], corner[1], Math.max(0, size), angle,
            color[0], color[1], color[2], marker ? 1 : alpha, uv[0], uv[1], uv[2], uv[3]], (i * 4 + c) * FLOATS);
        });
      });
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteData.subarray(0, batch.length * 4 * FLOATS));
      gl.drawElements(gl.TRIANGLES, batch.length * 6, gl.UNSIGNED_SHORT, 0);
    }
  }
  attributes.forEach((location) => gl.disableVertexAttribArray(location));
  gl.depthMask(true);
};

// ---- Loop --------------------------------------------------------------
const resize = () => {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
};
const stepOnce = () => {
  const origin = rootOrigin();
  for (const id of state.roots) world.setOrigin(id, origin);
  world.step();
  state.time += 1 / STEP_HZ;
};
const draw = () => {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  const sky = $('sky').value;
  gl.clearColor(parseInt(sky.slice(1, 3), 16) / 255, parseInt(sky.slice(3, 5), 16) / 255, parseInt(sky.slice(5, 7), 16) / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const basis = cameraBasis();
  const matrix = viewProjection(basis);
  if ($('showGrid').checked) drawLines(GRID, matrix, true);
  const blend = state.playing ? Math.min(1, state.accumulator * STEP_HZ) : 1;
  drawSystems(matrix, basis, blend);
  if ($('showVolume').checked) {
    const lines = [];
    for (const system of world.systems) {
      const def = systems.get(system.name.toLowerCase());
      if (def && state.roots.includes(system.id)) volumeLines(lines, def, system.origin);
    }
    drawLines(lines, matrix, false);
  }
};
let last = performance.now();
const frame = (now) => {
  const seconds = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (state.playing && state.scene) {
    state.accumulator += seconds * state.speed;
    let steps = 0;
    while (state.accumulator >= 1 / STEP_HZ && steps++ < 8) {
      state.accumulator -= 1 / STEP_HZ;
      stepOnce();
    }
    if (!world.systems.length) {
      state.idle += seconds;
      if ($('loop').checked && state.idle > 0.6) start();
    }
  }
  if (graphics) draw();
  const dropped = world.dropped ? '  dropped ' + world.dropped : '';
  hud.textContent = (graphics ? '' : 'WebGL is not available; nothing is drawn.' + '\\u000a') + 'frame ' + world.frame + '  ' + (world.frame / STEP_HZ).toFixed(1) + ' s' + '\\u000a' +
    world.systems.length + ' systems  ' + world.liveParticles + ' particles' + dropped + '\\u000a' +
    'wind ' + world.options.wind + '  hollow box ' + world.options.hollowBox;
  if (now - lastStatus > 1000) {
    lastStatus = now;
    vscode.postMessage({ kind: 'status', frame: world.frame, systems: world.systems.length, particles: world.liveParticles });
  }
  requestAnimationFrame(frame);
};
let lastStatus = 0;

// ---- Controls ----------------------------------------------------------
const setPlaying = (playing) => { state.playing = playing; $('play').textContent = playing ? 'Pause' : 'Play'; };
$('play').onclick = () => setPlaying(!state.playing);
$('restart').onclick = () => start();
$('step').onclick = () => { setPlaying(false); stepOnce(); };
$('speed').onchange = () => { state.speed = Number($('speed').value); };
const syncOptions = () => {
  world.options.wind = $('wind').value;
  world.options.hollowBox = $('hollowBox').value;
  world.options.compound = $('compound').checked;
  world.options.batchLimit = $('batchLimit').checked;
};
for (const id of ['wind', 'hollowBox', 'compound', 'batchLimit']) $(id).onchange = () => { syncOptions(); start(); };
const cycle = (id) => {
  const select = $(id);
  select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
  select.onchange();
};
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === ' ') { event.preventDefault(); setPlaying(!state.playing); }
  else if (event.key === 'r' || event.key === 'R') start();
  else if (event.key === '.') { setPlaying(false); stepOnce(); }
  else if (event.key === 'w' || event.key === 'W') cycle('wind');
  else if (event.key === 'h' || event.key === 'H') cycle('hollowBox');
});
$('apply').onclick = () => vscode.postMessage({ kind: 'apply' });
$('reset').onclick = () => vscode.postMessage({ kind: 'reset' });

/** A slider's span: around the value, wide enough to explore */
const sliderSpan = (field) => {
  const key = field.keyword.toLowerCase();
  const v = field.value;
  if (/^color[1-8]$/.test(key) && field.part !== 'frame') return [0, 255, 1];
  if (/^alpha[1-8]$/.test(key) && field.part !== 'frame') return [0, 1, 0.01];
  if (/damping/.test(key)) return [0, Math.max(1.2, v * 1.5), 0.001];
  if (/angle/.test(key) && !/rate/.test(key)) return [-6.2832, 6.2832, 0.01];
  if (field.integer) return [Math.min(0, v * 2), Math.max(10, Math.abs(v) * 3), 1];
  const width = Math.max(1, Math.abs(v) * 3);
  return [v < 0 ? -width : Math.min(0, v - width), width, width / 500];
};

const renderFields = (scene) => {
  const container = $('fields');
  const changed = Object.keys(scene.values).length > 0;
  $('apply').disabled = !changed;
  $('reset').disabled = !changed;
  const groups = new Map();
  for (const field of scene.fields) {
    const group = field.module || scene.root.name;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(field);
  }
  // Keep the element being dragged: rebuilding would end the drag
  const active = document.activeElement && document.activeElement.dataset.id;
  if (active && container.querySelector('[data-id="' + active + '"]')) {
    for (const element of container.querySelectorAll('[data-id]')) {
      const value = scene.values[element.dataset.id];
      const field = scene.fields.find((each) => each.id === element.dataset.id);
      if (!field || element === document.activeElement) continue;
      element.value = value !== undefined ? value : field.value;
      element.closest('.field').classList.toggle('changed', value !== undefined);
    }
    return;
  }
  container.replaceChildren(...[...groups].flatMap(([group, fields]) => {
    const heading = document.createElement('h3');
    heading.textContent = group;
    return [heading, ...fields.map((field) => {
      const row = document.createElement('div');
      const current = scene.values[field.id] !== undefined ? scene.values[field.id] : field.value;
      row.className = 'field' + (scene.values[field.id] !== undefined ? ' changed' : '');
      const label = document.createElement('label');
      label.textContent = field.keyword + (field.part ? ' ' + field.part : '');
      label.title = 'Line ' + (field.line + 1) + ', written ' + field.value + '. Click to show it in the file.';
      label.onclick = () => vscode.postMessage({ kind: 'reveal', line: field.line });
      const [min, max, step] = sliderSpan(field);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(Math.min(min, current));
      range.max = String(Math.max(max, current));
      range.step = String(step);
      range.value = String(current);
      range.dataset.id = field.id;
      const number = document.createElement('input');
      number.type = 'number';
      number.step = String(step);
      number.value = String(current);
      number.dataset.id = field.id;
      const send = (value) => {
        if (!Number.isFinite(value)) return;
        if (field.integer) value = Math.round(value);
        range.value = String(value);
        number.value = String(value);
        row.classList.add('changed');
        vscode.postMessage({ kind: 'set', id: field.id, value });
      };
      range.oninput = () => send(Number(range.value));
      number.onchange = () => send(Number(number.value));
      row.append(label, range, number);
      return row;
    })];
  }));
};

window.addEventListener('message', ({ data }) => {
  if (data.kind === 'scene') {
    const first = !state.scene;
    state.scene = data;
    systems = new Map(Object.entries(data.systems));
    fxLists = new Map(Object.entries(data.fxLists));
    loadTextures(data.textures);
    $('title').textContent = (data.root.kind === 'fxList' ? 'FX list ' : '') + data.root.name;
    $('notice').textContent = '';
    $('notes').replaceChildren(...data.notes.map((note) => {
      const line = document.createElement('div');
      line.textContent = '• ' + note;
      return line;
    }));
    renderFields(data);
    if (first) {
      const def = systems.get(data.root.name.toLowerCase());
      state.distance = def ? reach(def) * 2.2 : 260;
      state.target = [0, 0, def ? Math.min(80, reach(def) / 3) : 20];
    }
    if (data.restart || first) start();
  } else if (data.kind === 'notice') {
    $('notice').textContent = data.message;
  }
});

syncOptions();
requestAnimationFrame(frame);
vscode.postMessage({ kind: 'ready' });
`;
