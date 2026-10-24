/**
 * Page code of the APT inspector: the character list, the stage that draws
 * the selected character, and the details panel. It runs in the webview and
 * reads only what `aptEditorProvider` sends; drawing is plain canvas 2D.
 *
 * Kept apart from the provider because it is page code: it reaches the
 * extension only through `vscode.postMessage`, to ask for an action block's
 * listing or, in the editor, to send an edit.
 */
export const APT_VIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const list = document.getElementById('list');
const filter = document.getElementById('filter');
const stage = document.getElementById('stage');
const details = document.getElementById('details');
const frameInput = document.getElementById('frame');
const frameLabel = document.getElementById('frame-label');
const zoomSelect = document.getElementById('zoom');
const state = { movie: undefined, selected: 0, frame: 0, textures: new Map() };

const TYPE_NAMES = {
  movie: 'Movie', shape: 'Shape', editText: 'EditText', font: 'Font', button: 'Button',
  sprite: 'Sprite', image: 'Image', morph: 'Morph', text: 'Text', placeholder: 'Import', unknown: 'Unknown',
};

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** A character's label in the list: its id, type and any export or import name */
const describe = (character) => {
  const movie = state.movie;
  const exported = movie.exports.filter((e) => e.character === character.id).map((e) => e.name);
  const imported = movie.imports.find((i) => i.character === character.id);
  const extra = exported.length ? exported.join(', ') : imported ? imported.movie + ':' + imported.name : character.type === 'editText' ? (character.variable || character.text || '') : '';
  return '#' + character.id + ' ' + TYPE_NAMES[character.type] + (extra ? ' · ' + extra : '');
};

/** Frames of a timeline: the movie's own, or a sprite's */
const framesOf = (character) => character.type === 'movie' ? state.movie.frames : character.type === 'sprite' ? state.movie.spriteFrames[character.id] || [] : [];

/** The display list after a timeline's frame: depth to placement, cumulative */
const displayList = (frames, frame) => {
  const list = new Map();
  for (let index = 0; index <= frame && index < frames.length; index++) {
    for (const item of frames[index].items) {
      if (item.type === 'removeObject') {
        list.delete(item.depth);
      } else if (item.type === 'placeObject') {
        const existing = list.get(item.depth);
        const isNew = !(item.flags & 1) || !existing;
        const next = isNew ? { matrix: [1, 0, 0, 1], translate: [0, 0], alpha: 1 } : { ...existing };
        if (item.character !== undefined) next.character = item.character;
        if (item.matrix) { next.matrix = item.matrix; next.translate = item.translate; }
        if (item.colorTransform !== undefined) next.alpha = (item.colorTransform >>> 24) / 255;
        if (item.name !== undefined) next.name = item.name;
        if (next.character !== undefined) list.set(item.depth, next);
      }
    }
  }
  return [...list.entries()].sort((a, b) => a[0] - b[0]).map(([depth, placement]) => ({ depth, ...placement }));
};

/** Draws a character into a 2D context at the current transform */
const draw = (ctx, id, depth, frame) => {
  const character = state.movie.characters[id];
  if (!character || depth > 12) return;
  switch (character.type) {
    case 'shape': {
      for (const run of state.movie.shapes[id] || []) {
        const path = new Path2D();
        for (let i = 0; i < run.triangles.length; i += 6) {
          path.moveTo(run.triangles[i], run.triangles[i + 1]);
          path.lineTo(run.triangles[i + 2], run.triangles[i + 3]);
          path.lineTo(run.triangles[i + 4], run.triangles[i + 5]);
          path.closePath();
        }
        const [r, g, b, a] = run.style.color;
        if (run.style.kind === 'solid') {
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a / 255 + ')';
          ctx.fill(path);
        } else if (run.style.kind === 'texture') {
          const texture = state.textures.get(state.movie.imageTextures[run.style.character]);
          ctx.save();
          ctx.clip(path);
          if (texture) {
            const [m00, m01, m10, m11, tx, ty] = run.style.transform;
            const det = m00 * m11 - m01 * m10 || 1;
            // The style maps shape space to image pixels; drawing needs the inverse
            ctx.transform(m11 / det, -m01 / det, -m10 / det, m00 / det, (m10 * ty - m11 * tx) / det, (m01 * tx - m00 * ty) / det);
            ctx.globalAlpha *= a / 255;
            ctx.drawImage(texture, 0, 0);
          } else {
            ctx.fillStyle = 'rgba(255,0,255,0.35)';
            ctx.fill(path);
          }
          ctx.restore();
        } else if (run.style.kind === 'line') {
          ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a / 255 + ')';
          ctx.lineWidth = run.style.width || 1;
          ctx.beginPath();
          for (let i = 0; i < run.lines.length; i += 4) {
            ctx.moveTo(run.lines[i], run.lines[i + 1]);
            ctx.lineTo(run.lines[i + 2], run.lines[i + 3]);
          }
          ctx.stroke();
        }
      }
      break;
    }
    case 'image': {
      const texture = state.textures.get(state.movie.imageTextures[id]);
      if (texture) ctx.drawImage(texture, 0, 0);
      break;
    }
    case 'editText': {
      const [left, top, right, bottom] = character.bounds;
      const color = character.color >>> 0;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(120,160,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.fillStyle = 'rgba(' + ((color >> 16) & 255) + ',' + ((color >> 8) & 255) + ',' + (color & 255) + ',' + ((color >>> 24) / 255) + ')';
      ctx.font = Math.max(1, character.fontHeight) + 'px sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = character.alignment === 1 ? 'right' : character.alignment === 2 ? 'center' : 'left';
      const x = character.alignment === 1 ? right : character.alignment === 2 ? (left + right) / 2 : left;
      const lines = String(character.text ?? (character.variable ? '{' + character.variable + '}' : '')).split('\\n');
      lines.forEach((line, index) => ctx.fillText(line, x, top + index * character.fontHeight * 1.15, right - left));
      ctx.restore();
      break;
    }
    case 'button':
      for (const record of character.records) {
        if (!(record.flags & 1)) continue;
        ctx.save();
        ctx.transform(...record.matrix, ...record.translate);
        draw(ctx, record.character, depth + 1, 0);
        ctx.restore();
      }
      break;
    case 'sprite':
    case 'movie':
      for (const placement of displayList(framesOf(character), depth === 0 ? frame : 0)) {
        ctx.save();
        ctx.transform(...placement.matrix, ...placement.translate);
        ctx.globalAlpha *= placement.alpha;
        draw(ctx, placement.character, depth + 1, 0);
        ctx.restore();
      }
      break;
    case 'placeholder': {
      const imported = state.movie.imports.find((i) => i.character === id);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,180,0,0.8)';
      ctx.strokeRect(0, 0, 64, 24);
      ctx.fillStyle = 'rgba(255,180,0,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText(imported ? imported.name : 'import', 4, 14, 56);
      ctx.restore();
      break;
    }
  }
};

/** A box around everything a character draws, by drawing it into a recorder */
const boundsOf = (id) => {
  const character = state.movie.characters[id];
  if (character.type === 'movie') return [0, 0, state.movie.record.screenWidth, state.movie.record.screenHeight];
  if (character.bounds) return character.bounds;
  if (character.type === 'image') {
    const texture = state.textures.get(state.movie.imageTextures[id]);
    return [0, 0, texture ? texture.width : 64, texture ? texture.height : 64];
  }
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (cid, m, depth, frame) => {
    const c = state.movie.characters[cid];
    if (!c || depth > 12) return;
    const corner = (x, y) => {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];
      box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py);
      box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py);
    };
    if (c.bounds) { corner(c.bounds[0], c.bounds[1]); corner(c.bounds[2], c.bounds[3]); corner(c.bounds[0], c.bounds[3]); corner(c.bounds[2], c.bounds[1]); return; }
    const children = c.type === 'button' ? c.records.filter((r) => r.flags & 1).map((r) => ({ character: r.character, matrix: r.matrix, translate: r.translate })) : (c.type === 'sprite' || c.type === 'movie') ? displayList(framesOf(c), depth === 0 ? frame : 0) : [];
    for (const child of children) {
      const [a, b, cc, d] = child.matrix;
      const [tx, ty] = child.translate;
      visit(child.character, [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * cc + m[2] * d, m[1] * cc + m[3] * d, m[0] * tx + m[2] * ty + m[4], m[1] * tx + m[3] * ty + m[5]], depth + 1, 0);
    }
  };
  visit(id, [1, 0, 0, 1, 0, 0], 0, state.frame);
  return Number.isFinite(box[0]) ? box : [0, 0, 64, 64];
};

const render = () => {
  const id = state.selected;
  const [left, top, right, bottom] = boundsOf(id);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom = zoomSelect.value === 'fit' ? Math.min(4, Math.max(0.05, Math.min((stage.parentElement.clientWidth - 24) / width, (window.innerHeight - 160) / height))) : Number(zoomSelect.value);
  const ratio = window.devicePixelRatio || 1;
  stage.width = Math.ceil((width + 16) * zoom * ratio);
  stage.height = Math.ceil((height + 16) * zoom * ratio);
  stage.style.width = stage.width / ratio + 'px';
  stage.style.height = stage.height / ratio + 'px';
  const ctx = stage.getContext('2d');
  ctx.setTransform(zoom * ratio, 0, 0, zoom * ratio, (8 - left) * zoom * ratio, (8 - top) * zoom * ratio);
  ctx.clearRect(left - 8, top - 8, width + 16, height + 16);
  draw(ctx, id, 0, state.frame);
};

/** The action blocks a character or its timeline runs, for the details panel */
const blocksOf = (character) => {
  const blocks = [];
  framesOf(character).forEach((frame, index) => {
    for (const item of frame.items) {
      if (item.type === 'action') blocks.push({ label: 'frame ' + index, block: item.block });
      if (item.type === 'initAction') blocks.push({ label: 'init #' + item.sprite, block: item.block });
      for (const clip of item.clipActions || []) blocks.push({ label: 'frame ' + index + ' clip events 0x' + clip.events.toString(16) + ' @' + item.depth, block: clip.block });
    }
  });
  if (character.type === 'button') character.actions.forEach((action) => blocks.push({ label: 'button 0x' + action.condition.toString(16), block: action.block }));
  return blocks;
};

const showDetails = () => {
  const character = state.movie.characters[state.selected];
  const frames = framesOf(character);
  frameInput.max = String(Math.max(0, frames.length - 1));
  frameInput.disabled = frames.length < 2;
  frameInput.value = String(Math.min(state.frame, Math.max(0, frames.length - 1)));
  const labels = frames.flatMap((frame, index) => frame.items.filter((i) => i.type === 'frameLabel').map((i) => index + ':' + i.label));
  frameLabel.textContent = frames.length ? 'frame ' + state.frame + ' of ' + frames.length + (labels.length ? ' · labels ' + labels.join(', ') : '') : '';
  const { offset, ...fields } = character;
  const blocks = blocksOf(character);
  details.innerHTML = '<h3>' + escapeHtml(describe(character)) + '</h3><p class="muted">record at 0x' + offset.toString(16) + '</p><pre>' + escapeHtml(JSON.stringify(fields, (key, value) => (key === 'records' || key === 'glyphs') && Array.isArray(value) && value.length > 8 ? '[' + value.length + ' entries]' : value, 2)) + '</pre>' +
    (blocks.length ? '<h3>Scripts</h3>' + blocks.map((b, i) => '<details data-block="' + b.block + '"><summary>' + escapeHtml(b.label) + ' · 0x' + b.block.toString(16) + '</summary><pre class="code">…</pre></details>').join('') : '');
  details.querySelectorAll('details[data-block]').forEach((element) => element.addEventListener('toggle', () => {
    if (element.open) vscode.postMessage({ kind: 'listing', block: Number(element.dataset.block) });
  }, { once: true }));
};

const select = (id) => {
  state.selected = id;
  state.frame = 0;
  list.querySelectorAll('.row').forEach((row) => row.classList.toggle('selected', Number(row.dataset.id) === id));
  showDetails();
  render();
};

const showList = () => {
  const needle = filter.value.toLowerCase();
  list.replaceChildren(...state.movie.characters.filter((c) => !needle || describe(c).toLowerCase().includes(needle)).map((character) => {
    const row = document.createElement('div');
    row.className = 'row' + (character.id === state.selected ? ' selected' : '');
    row.dataset.id = String(character.id);
    row.textContent = describe(character);
    row.onclick = () => select(character.id);
    return row;
  }));
};

filter.oninput = showList;
zoomSelect.onchange = render;
frameInput.oninput = () => { state.frame = Number(frameInput.value); showDetails(); render(); };
window.addEventListener('resize', render);

window.addEventListener('message', async ({ data }) => {
  if (data.kind === 'movie') {
    state.movie = data.movie;
    for (const [path, texture] of Object.entries(data.textures)) {
      const canvas = document.createElement('canvas');
      canvas.width = texture.width;
      canvas.height = texture.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(texture.pixels), texture.width, texture.height), 0, 0);
      state.textures.set(path, canvas);
    }
    document.getElementById('summary').textContent = data.summary;
    showList();
    select(0);
  } else if (data.kind === 'listing') {
    const element = details.querySelector('details[data-block="' + data.block + '"] pre');
    if (element) element.textContent = data.text;
  } else if (data.kind === 'error') {
    document.body.innerHTML = '<p class="error">Cannot open this movie: ' + escapeHtml(data.message) + '</p>';
  }
});

vscode.postMessage({ kind: 'ready' });
`;
