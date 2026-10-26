/**
 * Script the preview page runs to draw a model with WebGL 2: every mesh lit
 * from the camera with its texture, or flat grey where it has none, on an
 * orbit camera around the model's bounds. Z is up, as in the games.
 *
 * Kept apart from `previewEditorProvider` because it is page code, not
 * extension code: it runs in the webview and only reads the message it is
 * sent. It defines `showModel(message)` for the page's message handler,
 * which returns the controls an animation message drives.
 *
 * A posed model is skinned here, on the CPU: every bone's transform is the
 * bind pose composed with the animation's change for that frame (rotation
 * then translation in the bind rotation's frame, as mint's `pose.rs` has it,
 * the root's own channels ignored), and each vertex follows its bone.
 */
export const MODEL_SCRIPT = /* js */ `
const VERTEX_SHADER = \`#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 viewProjection;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = viewProjection * vec4(position, 1.0);
}\`;

const FRAGMENT_SHADER = \`#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D tex;
uniform bool hasTexture;
uniform bool hasNormals;
uniform vec3 lightDirection;
uniform bool useSolid;
uniform vec4 solid;
out vec4 colour;
void main() {
  if (useSolid) { colour = solid; return; }
  vec4 base = hasTexture ? texture(tex, vUv) : vec4(0.7, 0.7, 0.7, 1.0);
  if (base.a < 0.3) discard;
  float light = hasNormals ? abs(dot(normalize(vNormal), lightDirection)) : 1.0;
  colour = vec4(base.rgb * (0.35 + 0.65 * light), 1.0);
}\`;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
};

const perspective = (fov, aspect, near, far) => {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
};

const lookAt = (eye, target, up) => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
};

const multiplyMatrices = (a, b) => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};

const quatMultiply = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const quatRotate = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

const normalise = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };

/** outer after inner: rotate inner's translation by outer, then add */
const compose = (outer, inner) => {
  const r = quatRotate(outer.q, inner.t);
  return { t: [r[0] + outer.t[0], r[1] + outer.t[1], r[2] + outer.t[2]], q: normalise(quatMultiply(outer.q, inner.q)) };
};

/** One channel's value at a fractional frame, blending its neighbours */
const sampleChannel = (channel, frame, frameCount) => {
  const width = channel.kind === 'rotation' ? 4 : 1;
  const first = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
  const second = Math.min(frameCount - 1, first + 1);
  const t = frame - Math.floor(frame);
  const at = (index) => Array.from(channel.values.subarray(index * width, index * width + width));
  if (!channel.present[first]) return channel.present[second] ? at(second) : undefined;
  const a = at(first);
  if (!channel.present[second] || t === 0 || channel.kind === 'visibility') return a;
  const b = at(second);
  if (width === 1) return [a[0] + (b[0] - a[0]) * t];
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return normalise(a.map((value, index) => value + (b[index] * sign - value) * t));
};

/** Every bone's world transform, bind pose with the animation applied */
const computePose = (skeleton, animation, frame) => {
  const count = skeleton.parents.length;
  const world = [];
  const visible = [];
  const byPivot = new Map();
  for (const channel of animation ? animation.channels : []) {
    if (channel.pivot === 0 || channel.pivot >= count) continue;
    if (!byPivot.has(channel.pivot)) byPivot.set(channel.pivot, []);
    byPivot.get(channel.pivot).push(channel);
  }
  for (let index = 0; index < count; index++) {
    const delta = { t: [0, 0, 0], q: [0, 0, 0, 1] };
    let shown = true;
    for (const channel of byPivot.get(index) || []) {
      const value = sampleChannel(channel, frame, animation.frameCount);
      if (!value) continue;
      if (channel.kind === 'x') delta.t[0] = value[0];
      else if (channel.kind === 'y') delta.t[1] = value[0];
      else if (channel.kind === 'z') delta.t[2] = value[0];
      else if (channel.kind === 'rotation') delta.q = value;
      else if (channel.kind === 'visibility') shown = value[0] > 0.5;
    }
    const bind = { t: skeleton.translations.slice(index * 3, index * 3 + 3), q: skeleton.rotations.slice(index * 4, index * 4 + 4) };
    const local = compose(bind, delta);
    const parent = skeleton.parents[index];
    world.push(parent >= 0 && parent < index ? compose(world[parent], local) : local);
    visible.push(shown);
  }
  return { world, visible };
};

const showModel = (message) => {
  const { meshes, textures, missing, hierarchy, bounds, skeleton } = message;
  const canvas = document.createElement('canvas');
  canvas.className = 'model';
  const info = document.createElement('p');
  const controls = document.createElement('div');
  controls.className = 'controls';
  const triangles = meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0);
  info.textContent = (message.shownOn ? 'Shown on ' + message.shownOn + ', the model drawn on its skeleton · ' : '') +
    meshes.length + ' meshes · ' + triangles + ' triangles' +
    (hierarchy ? ' · skeleton ' + hierarchy + ' (' + skeleton.parents.length + ' bones)' : '') +
    (missing.length ? ' · textures not found: ' + missing.join(', ') : '') +
    ' · drag to orbit, scroll to zoom, double-click to reset';
  main.replaceChildren(controls, canvas, info);

  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    info.textContent = 'This view needs WebGL 2, which is not available here.';
    return undefined;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const glTextures = textures.map(({ width, height, pixels }) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return texture;
  });

  const attribute = (name, data, size, usage) => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return undefined;
    if (!data) { gl.disableVertexAttribArray(location); return undefined; }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  };

  const drawables = meshes.map((mesh) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const usage = mesh.local ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    const positionBuffer = attribute('position', mesh.positions, 3, usage);
    const normalBuffer = attribute('normal', mesh.normals, 3, usage);
    attribute('uv', mesh.uvs, 2);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao, count: mesh.indices.length, texture: mesh.texture, hasNormals: Boolean(mesh.normals), hasUvs: Boolean(mesh.uvs),
      local: mesh.local, positionBuffer, normalBuffer,
      posed: mesh.local && { positions: new Float32Array(mesh.positions.length), normals: mesh.normals && new Float32Array(mesh.normals.length) },
    };
  });

  const boneVao = gl.createVertexArray();
  gl.bindVertexArray(boneVao);
  const boneBuffer = attribute('position', new Float32Array(Math.max(1, (skeleton ? skeleton.parents.length : 0) * 6)), 3, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  const radius = Math.max(1e-3, Math.hypot(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis])) / 2);
  const initial = { yaw: -Math.PI / 4, pitch: 0.4, distance: radius * 2.6 };
  const camera = { ...initial };
  const player = { animation: undefined, frame: 0, playing: false, speed: 1, showBones: !meshes.length, pose: skeleton ? computePose(skeleton, undefined, 0) : undefined, last: 0 };

  /** Moves every bound vertex onto its bone's current transform */
  const applyPose = () => {
    const world = player.pose.world;
    for (const drawable of drawables) {
      if (!drawable.local) continue;
      const { positions, normals, bones } = drawable.local;
      for (let vertex = 0; vertex < bones.length; vertex++) {
        const bone = world[bones[vertex]];
        if (!bone) continue;
        const at = vertex * 3;
        const p = quatRotate(bone.q, [positions[at], positions[at + 1], positions[at + 2]]);
        drawable.posed.positions[at] = p[0] + bone.t[0];
        drawable.posed.positions[at + 1] = p[1] + bone.t[1];
        drawable.posed.positions[at + 2] = p[2] + bone.t[2];
        if (normals) drawable.posed.normals.set(quatRotate(bone.q, [normals[at], normals[at + 1], normals[at + 2]]), at);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, drawable.positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawable.posed.positions);
      if (normals && drawable.normalBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawable.normalBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, drawable.posed.normals);
      }
    }
  };

  const draw = () => {
    const width = Math.max(1, Math.floor(main.clientWidth - 24));
    const height = Math.max(240, Math.floor(window.innerHeight - 170));
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.16, 0.17, 0.19, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const eye = [
      centre[0] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
      centre[1] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
      centre[2] + camera.distance * Math.sin(camera.pitch),
    ];
    const projection = perspective(Math.PI / 4, canvas.width / canvas.height, radius / 100, radius * 100);
    gl.uniformMatrix4fv(uniform('viewProjection'), false, multiplyMatrices(projection, lookAt(eye, centre, [0, 0, 1])));
    const toCamera = eye.map((value, axis) => value - centre[axis]);
    const length = Math.hypot(...toCamera);
    gl.uniform3fv(uniform('lightDirection'), toCamera.map((value) => value / length));
    gl.uniform1i(uniform('useSolid'), 0);

    for (const drawable of drawables) {
      const texture = drawable.hasUvs && drawable.texture !== undefined ? glTextures[drawable.texture] : undefined;
      gl.uniform1i(uniform('hasTexture'), texture ? 1 : 0);
      gl.uniform1i(uniform('hasNormals'), drawable.hasNormals ? 1 : 0);
      if (texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform('tex'), 0);
      }
      gl.bindVertexArray(drawable.vao);
      gl.drawElements(gl.TRIANGLES, drawable.count, gl.UNSIGNED_INT, 0);
    }

    if (player.showBones && player.pose) {
      const lines = [];
      player.pose.world.forEach((bone, index) => {
        const parent = skeleton.parents[index];
        if (parent >= 0 && player.pose.world[parent]) lines.push(...player.pose.world[parent].t, ...bone.t);
      });
      if (lines.length) {
        gl.disable(gl.DEPTH_TEST);
        gl.uniform1i(uniform('useSolid'), 1);
        gl.uniform4fv(uniform('solid'), [1, 0.75, 0.2, 1]);
        gl.bindVertexArray(boneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, boneBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(lines));
        gl.drawArrays(gl.LINES, 0, lines.length / 3);
        gl.drawArrays(gl.POINTS, 0, lines.length / 3);
      }
    }
    gl.bindVertexArray(null);
  };

  // Animation controls: a list of the skeleton's animations, play, a frame slider
  const select = document.createElement('select');
  const play = document.createElement('button');
  const slider = document.createElement('input');
  const label = document.createElement('span');
  const bones = document.createElement('button');
  slider.type = 'range';
  slider.min = '0';
  slider.step = 'any';
  slider.disabled = true;
  play.textContent = 'Play';
  play.disabled = true;
  bones.textContent = 'Bones';
  bones.setAttribute('aria-pressed', String(player.showBones));
  label.className = 'status';
  const bind = document.createElement('option');
  bind.value = '';
  bind.textContent = skeleton ? 'Bind pose' : 'No skeleton';
  select.append(bind);
  if (skeleton) controls.append(select, play, slider, bones, label);

  const showFrame = () => {
    player.pose = computePose(skeleton, player.animation, player.frame);
    applyPose();
    slider.value = String(player.frame);
    label.textContent = player.animation ? player.animation.name + ' · frame ' + player.frame.toFixed(1) + ' / ' + player.animation.frameCount + ' · ' + player.animation.frameRate + ' fps' : '';
    draw();
  };

  const tick = (time) => {
    if (!player.playing || !player.animation) return;
    const elapsed = player.last ? (time - player.last) / 1000 : 0;
    player.last = time;
    player.frame = (player.frame + elapsed * player.animation.frameRate * player.speed) % Math.max(1, player.animation.frameCount - 1);
    showFrame();
    requestAnimationFrame(tick);
  };

  const setPlaying = (playing) => {
    player.playing = playing && Boolean(player.animation);
    play.textContent = player.playing ? 'Pause' : 'Play';
    player.last = 0;
    if (player.playing) requestAnimationFrame(tick);
  };

  play.onclick = () => setPlaying(!player.playing);
  slider.oninput = () => { setPlaying(false); player.frame = Number(slider.value); showFrame(); };
  bones.onclick = () => { player.showBones = !player.showBones; bones.setAttribute('aria-pressed', String(player.showBones)); draw(); };
  select.onchange = () => {
    if (!select.value) {
      player.animation = undefined;
      setPlaying(false);
      play.disabled = true;
      slider.disabled = true;
      player.frame = 0;
      showFrame();
    } else if (select.value !== '#own') {
      label.textContent = 'Loading ' + select.value + '…';
      vscode.postMessage({ kind: 'animation', file: select.value });
    } else {
      control.play({ file: '#own', animation: message.animation });
    }
  };

  let dragging;
  canvas.addEventListener('pointerdown', (event) => { dragging = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = undefined; });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    camera.yaw -= (event.clientX - dragging.x) * 0.01;
    camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + (event.clientY - dragging.y) * 0.01));
    dragging = { x: event.clientX, y: event.clientY };
    draw();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.distance = Math.max(radius * 0.2, Math.min(radius * 20, camera.distance * Math.exp(event.deltaY * 0.001)));
    draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { Object.assign(camera, initial); draw(); });
  window.addEventListener('resize', draw);

  const control = {
    setAnimations: (names) => {
      for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name.replace(/\.w3d$/i, '');
        select.append(option);
      }
    },
    play: ({ file, animation }) => {
      if (animation.hierarchyName.toLowerCase() !== skeleton.name.toLowerCase()) {
        info.textContent = animation.name + ' is made for ' + animation.hierarchyName + ', not ' + skeleton.name + '; it may look wrong.';
      }
      player.animation = animation;
      player.frame = 0;
      select.value = file;
      play.disabled = false;
      slider.disabled = false;
      slider.max = String(Math.max(0, animation.frameCount - 1));
      showFrame();
      setPlaying(true);
    },
    notice: (text) => { label.textContent = text; },
  };

  if (message.animation && skeleton) {
    const own = document.createElement('option');
    own.value = '#own';
    own.textContent = message.animation.name + ' (this file)';
    select.append(own);
    control.play({ file: '#own', animation: message.animation });
  } else {
    draw();
  }

  return control;
};
`;
