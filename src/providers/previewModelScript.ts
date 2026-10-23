/**
 * Script the preview page runs to draw a model with WebGL 2: every mesh lit
 * from the camera with its texture, or flat grey where it has none, on an
 * orbit camera around the model's bounds. Z is up, as in the games.
 *
 * Kept apart from `previewEditorProvider` because it is page code, not
 * extension code: it runs in the webview and only reads the message it is
 * sent. It defines `showModel(message)` for the page's message handler.
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
out vec4 colour;
void main() {
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

const showModel = (message) => {
  const { meshes, textures, missing, hierarchy, bounds } = message;
  const canvas = document.createElement('canvas');
  canvas.className = 'model';
  const info = document.createElement('p');
  const triangles = meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0);
  info.textContent = meshes.length + ' meshes · ' + triangles + ' triangles' +
    (hierarchy ? ' · skeleton ' + hierarchy : '') +
    (missing.length ? ' · textures not found: ' + missing.join(', ') : '') +
    ' · drag to orbit, scroll to zoom, double-click to reset';
  main.replaceChildren(canvas, info);

  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    info.textContent = 'This view needs WebGL 2, which is not available here.';
    return;
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

  const attribute = (name, data, size) => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    if (!data) { gl.disableVertexAttribArray(location); return; }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  const drawables = meshes.map((mesh) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    attribute('position', mesh.positions, 3);
    attribute('normal', mesh.normals, 3);
    attribute('uv', mesh.uvs, 2);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.indices.length, texture: mesh.texture, hasNormals: Boolean(mesh.normals), hasUvs: Boolean(mesh.uvs) };
  });

  const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  const radius = Math.max(1e-3, Math.hypot(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis])) / 2);
  const initial = { yaw: -Math.PI / 4, pitch: 0.4, distance: radius * 2.6 };
  const camera = { ...initial };

  const draw = () => {
    const width = Math.max(1, Math.floor(main.clientWidth - 24));
    const height = Math.max(240, Math.floor(window.innerHeight - 140));
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
  draw();
};
`;
