/**
 * Page code of the APT inspector: the character list, the stage that draws
 * the selected character, and the details panel. It runs in the webview and
 * reads only what `aptEditorProvider` sends; drawing is plain canvas 2D.
 *
 * Kept apart from the provider because it is page code: it reaches the
 * extension only through `vscode.postMessage`, to ask for an action block's
 * script or, in the editor, to send an edit.
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
const state = { movie: undefined, selected: 0, frame: 0, textures: new Map(), openBlocks: new Set(), drafts: new Map() };

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

/** Sends an edit; the extension applies it and sends the movie back */
const send = (edit) => vscode.postMessage({ kind: 'edit', edit });

/** An input that commits on change: a number, a text, or a hex word */
const input = (value, onCommit, kind = 'number') => {
  const element = document.createElement(kind === 'text' ? 'textarea' : 'input');
  if (kind !== 'line') element.type = 'text';
  element.value = value === undefined ? '' : kind === 'hex' ? '0x' + (value >>> 0).toString(16).padStart(8, '0') : String(value);
  element.className = kind;
  element.onchange = () => {
    const raw = element.value.trim();
    const parsed = kind === 'text' || kind === 'line' ? element.value : kind === 'hex' ? parseInt(raw, 16) >>> 0 : Number(raw);
    if ((kind === 'number' || kind === 'hex') && !Number.isFinite(parsed)) { element.classList.add('invalid'); return; }
    onCommit(parsed);
  };
  return element;
};

/** A labelled row of inputs */
const row = (label, ...controls) => {
  const element = document.createElement('div');
  element.className = 'field';
  const name = document.createElement('label');
  name.textContent = label;
  element.append(name, ...controls);
  return element;
};

const button = (label, onClick) => {
  const element = document.createElement('button');
  element.textContent = label;
  element.onclick = onClick;
  return element;
};

const heading = (text) => {
  const element = document.createElement('h3');
  element.textContent = text;
  return element;
};

/** Inputs for a 2x2 matrix and a translation, raw so a skew survives */
const matrixInputs = (matrix, translate, onCommit) => {
  const values = [...(matrix || [1, 0, 0, 1]), ...(translate || [0, 0])];
  return ['a', 'b', 'c', 'd', 'x', 'y'].map((name, index) => {
    const element = input(values[index], (value) => {
      values[index] = value;
      onCommit(values.slice(0, 4), values.slice(4));
    });
    element.title = name;
    element.classList.add('short');
    return element;
  });
};

/** The fields of the selected character that can be edited, by type */
const characterFields = (character) => {
  const fields = [];
  const change = (field) => (value) => send({ kind: 'character', id: character.id, change: { field, value } });
  if (character.bounds && character.type !== 'line') {
    const bounds = [...character.bounds];
    fields.push(row('Bounds', ...bounds.map((value, index) => {
      const element = input(value, (next) => { bounds[index] = next; send({ kind: 'character', id: character.id, change: { field: 'bounds', value: bounds } }); });
      element.classList.add('short');
      return element;
    })));
  }
  if (character.type === 'editText') {
    fields.push(row('Text', input(character.text ?? '', (value) => change('line')(value === '' ? undefined : value), 'line')));
    fields.push(row('Variable', input(character.variable ?? '', (value) => change('variable')(value.trim() === '' ? undefined : value.trim()), 'line')));
    fields.push(row('Colour ARGB', input(character.color, change('color'), 'hex')));
    fields.push(row('Font height', input(character.fontHeight, change('fontHeight'))));
    fields.push(row('Font #', input(character.font, change('font'))));
    fields.push(row('Alignment', input(character.alignment, change('alignment'))));
    for (const flag of ['readonly', 'multiline', 'wordwrap']) {
      fields.push(row(flag, input(character[flag], change(flag))));
    }
  }
  if (character.type === 'font') fields.push(row('Font name', input(character.name ?? '', (value) => change('fontName')(value || undefined), 'line')));
  if (character.type === 'image') fields.push(row('Texture id', input(character.texture, change('texture'))));
  if (character.type === 'shape') {
    fields.push(row('Geometry', input(character.geometry, change('geometry')), button('Open .ru', () => vscode.postMessage({ kind: 'openGeometry', geometry: character.geometry }))));
  }
  if (character.type === 'button') {
    character.records.forEach((record, index) => {
      const flags = input(record.flags, (value) => send({ kind: 'buttonRecord', offset: record.offset, flags: value }));
      flags.title = 'bit 0 up, 1 over, 2 down, 3 hit test';
      fields.push(row('Record ' + index, flags, input(record.character, (value) => send({ kind: 'buttonRecord', offset: record.offset, character: value })), ...matrixInputs(record.matrix, record.translate, (matrix, translate) => send({ kind: 'buttonRecord', offset: record.offset, matrix, translate }))));
    });
  }
  if (character.type === 'movie') {
    const size = [character.record.screenWidth, character.record.screenHeight];
    fields.push(row('Screen', ...size.map((value, index) => input(value, (next) => { size[index] = next; send({ kind: 'screen', width: size[0], height: size[1] }); }))));
    fields.push(heading('Exports'));
    state.movie.exports.forEach((entry, index) => fields.push(row('', input(entry.name, (name) => send({ kind: 'export', index, name }), 'line'), input(entry.character, (value) => send({ kind: 'export', index, character: value })), button('Remove', () => send({ kind: 'removeExport', index })))));
    const added = { name: '', character: 1 };
    fields.push(row('New', input('', (name) => { added.name = name; }, 'line'), input(1, (value) => { added.character = value; }), button('Add export', () => added.name && send({ kind: 'addExport', ...added }))));
    if (state.movie.imports.length) {
      fields.push(heading('Imports'));
      state.movie.imports.forEach((entry, index) => fields.push(row('#' + entry.character, input(entry.movie, (movie) => send({ kind: 'import', index, movie }), 'line'), input(entry.name, (name) => send({ kind: 'import', index, name }), 'line'))));
    }
  }
  if (!['movie', 'placeholder', 'unknown'].includes(character.type)) {
    fields.push(row('', button('Duplicate', () => send({ kind: 'duplicateCharacter', id: character.id }))));
  }
  return fields;
};

/** The items of the shown frame of a timeline, each editable, and ways to add more */
const frameFields = (character) => {
  const frames = framesOf(character);
  const fields = [heading('Frame ' + state.frame)];
  const frame = frames[state.frame];
  const timeline = character.id;
  for (const item of frame ? frame.items : []) {
    const remove = button('×', () => send({ kind: 'removeItem', timeline, frame: state.frame, offset: item.offset }));
    remove.title = 'Remove this item from the frame';
    if (item.type === 'placeObject') {
      const placement = (change) => send({ kind: 'placement', offset: item.offset, change });
      const alpha = input(item.colorTransform === undefined ? 255 : item.colorTransform >>> 24, (value) => placement({ colorTransform: (((item.colorTransform ?? 0xffffffff) & 0xffffff) | (Math.max(0, Math.min(255, value)) << 24)) >>> 0 }));
      alpha.title = 'alpha 0-255';
      alpha.classList.add('short');
      fields.push(row('Place @' + item.depth, input(item.character ?? '', (value) => placement({ character: value })), ...matrixInputs(item.matrix, item.translate, (matrix, translate) => placement({ matrix, translate })), alpha, input(item.name ?? '', (name) => placement({ name }), 'line'), remove));
    } else if (item.type === 'frameLabel') {
      fields.push(row('Label', input(item.label, (label) => send({ kind: 'frameLabel', offset: item.offset, label }), 'line'), remove));
    } else if (item.type === 'removeObject') {
      fields.push(row('Remove @' + item.depth, remove));
    } else {
      fields.push(row(item.type, remove));
    }
  }
  const place = { character: 1, depth: 1 };
  fields.push(row('Place', input(1, (value) => { place.character = value; }), input(1, (value) => { place.depth = value; }), button('Add', () => send({ kind: 'placeObject', timeline, frame: state.frame, ...place }))));
  let label = '';
  fields.push(row('Label', input('', (value) => { label = value; }, 'line'), button('Add', () => label && send({ kind: 'addFrameLabel', timeline, frame: state.frame, label }))));
  fields.push(row('', button('Add frame', () => send({ kind: 'addFrame', timeline }))));
  return fields;
};

const showDetails = () => {
  const character = state.movie.characters[state.selected];
  const frames = framesOf(character);
  frameInput.max = String(Math.max(0, frames.length - 1));
  frameInput.disabled = frames.length < 2;
  state.frame = Math.min(state.frame, Math.max(0, frames.length - 1));
  frameInput.value = String(state.frame);
  const labels = frames.flatMap((frame, index) => frame.items.filter((i) => i.type === 'frameLabel').map((i) => index + ':' + i.label));
  frameLabel.textContent = frames.length ? 'frame ' + state.frame + ' of ' + frames.length + (labels.length ? ' · labels ' + labels.join(', ') : '') : '';
  const blocks = blocksOf(character);
  details.replaceChildren(heading(describe(character)));
  const offset = document.createElement('p');
  offset.className = 'muted';
  offset.textContent = 'record at 0x' + character.offset.toString(16);
  details.append(offset, ...characterFields(character));
  if (character.type === 'sprite' || character.type === 'movie') details.append(...frameFields(character));
  if (blocks.length) {
    details.append(heading('Scripts'));
    for (const b of blocks) {
      const element = document.createElement('details');
      element.dataset.block = String(b.block);
      const summary = document.createElement('summary');
      summary.textContent = b.label + ' · 0x' + b.block.toString(16);
      const body = document.createElement('div');
      body.className = 'script';
      body.textContent = '…';
      element.append(summary, body);
      element.addEventListener('toggle', () => {
        if (element.open) {
          state.openBlocks.add(b.block);
          vscode.postMessage({ kind: 'script', block: b.block });
        } else {
          state.openBlocks.delete(b.block);
        }
      });
      details.append(element);
      if (state.openBlocks.has(b.block)) element.open = true;
    }
  }
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

/** Fills a script panel: editable text, or a read-only listing */
const showScript = (data) => {
  const body = details.querySelector('details[data-block="' + data.block + '"] .script');
  if (!body) return;
  const editable = data.mode !== 'listing';
  const text = document.createElement('textarea');
  text.className = 'code';
  text.spellcheck = false;
  text.readOnly = !editable;
  text.value = state.drafts.get(data.block) ?? data.text;
  text.rows = Math.min(30, Math.max(4, text.value.split('\\n').length + 1));
  text.addEventListener('input', () => state.drafts.set(data.block, text.value));
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      text.setRangeText('  ', text.selectionStart, text.selectionEnd, 'end');
      state.drafts.set(data.block, text.value);
    }
  });
  const bar = document.createElement('div');
  bar.className = 'field';
  const mode = document.createElement('span');
  mode.className = 'muted';
  mode.textContent = data.mode === 'script' ? 'script' : data.mode === 'assembly' ? 'assembly (one instruction a line)' : 'listing, read-only';
  if (data.note) mode.title = data.note;
  bar.append(mode);
  if (editable) {
    bar.append(
      button('Apply', () => vscode.postMessage({ kind: 'scriptEdit', block: data.block, text: text.value })),
      button('Reset', () => { state.drafts.delete(data.block); text.value = data.text; }),
    );
  }
  body.replaceChildren(text, bar);
};

window.addEventListener('message', async ({ data }) => {
  if (data.kind === 'movie') {
    const isFirst = !state.movie;
    state.movie = data.movie;
    for (const [path, texture] of Object.entries(data.textures)) {
      const canvas = document.createElement('canvas');
      canvas.width = texture.width;
      canvas.height = texture.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(texture.pixels), texture.width, texture.height), 0, 0);
      state.textures.set(path, canvas);
    }
    document.getElementById('summary').textContent = data.summary;
    if (isFirst || !state.movie.characters[state.selected]) state.selected = 0;
    showList();
    showDetails();
    render();
  } else if (data.kind === 'select') {
    showList();
    select(data.character);
  } else if (data.kind === 'script') {
    showScript(data);
  } else if (data.kind === 'scriptSaved') {
    state.drafts.delete(data.previous);
    state.openBlocks.delete(data.previous);
    state.openBlocks.add(data.block);
    const element = details.querySelector('details[data-block="' + data.block + '"]');
    if (element && !element.open) element.open = true;
  } else if (data.kind === 'notice') {
    const notice = document.getElementById('notice');
    notice.textContent = data.message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6000);
  } else if (data.kind === 'error') {
    document.body.innerHTML = '<p class="error">Cannot open this movie: ' + escapeHtml(data.message) + '</p>';
  }
});

vscode.postMessage({ kind: 'ready' });
`;
