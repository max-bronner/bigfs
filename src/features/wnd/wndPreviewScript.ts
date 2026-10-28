/**
 * Page code of the preview; it has no backslashes, being in a template.
 *
 * It draws a window the way mint's `apt-viewer` gadgets do: a check box's
 * square box at the left with its label after it (`gadget/check.rs`), a
 * slider's row of segments and its thumb (`slider.rs`), a list box's body,
 * selection and scroll bar (`list.rs`), a combo box's drop-down button
 * (`combo.rs`). The slots each part reads are chosen in `wndLayout.ts`.
 */
export const WND_PREVIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const canvas = document.getElementById('screen');
const context = canvas.getContext('2d');
const status = document.getElementById('status');
const showHidden = document.getElementById('hidden');
const showOutlines = document.getElementById('outlines');
const stateSelect = document.getElementById('state');
const checkedBox = document.getElementById('checked');
const POINTS_TO_UNITS = 96 / 72;
const CHECK_INSET = 3;
const SLIDER_THUMB = [13, 16];
const SCROLL_BUTTON = [21, 22];
const THUMB_HEIGHT = 16;
const SEGMENT_GAP = 2;
let boxes = [];
let images = {};
const textures = {};
let placed = [];
let hover;

const css = (c, scale) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] / 255) * (scale === undefined ? 1 : scale) + ')';

const drawImage = (name, left, top, width, height) => {
  const info = images[name];
  const texture = info && textures[info.texture];
  if (!texture || !texture.naturalWidth || width <= 0 || height <= 0) return false;
  const sx = info.uv[0] * texture.naturalWidth;
  const sy = info.uv[1] * texture.naturalHeight;
  const sw = info.uv[2] * texture.naturalWidth;
  const sh = info.uv[3] * texture.naturalHeight;
  if (sw <= 0 || sh <= 0) return false;
  if (!info.rotated) {
    context.drawImage(texture, sx, sy, sw, sh, left, top, width, height);
  } else {
    // packed turned a quarter turn clockwise: turn it back
    context.save();
    context.translate(left, top);
    context.scale(width / sh, height / sw);
    context.transform(0, -1, 1, 0, 0, sw);
    context.drawImage(texture, sx, sy, sw, sh, 0, 0, sw, sh);
    context.restore();
  }
  return true;
};

const drawPart = (part, left, top, width, height) => {
  if (part.image) {
    drawImage(part.image, left, top, width, height);
  } else {
    if (part.color && part.color[3] > 0) {
      context.fillStyle = css(part.color);
      context.fillRect(left, top, width, height);
    }
    if (part.border && part.border[3] > 0) {
      context.strokeStyle = css(part.border);
      context.lineWidth = 1;
      context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    }
  }
};

const extentOf = (part, fallback) => (part && part.image && images[part.image] ? images[part.image].extent : fallback);

const drawSlider = (box, parts, rect, vertical) => {
  const [left, top, right, bottom] = rect;
  const find = (role) => parts.find((part) => part.role === role);
  const filled = find('bar-filled');
  const empty = find('bar-empty');
  const outline = find('outline');
  const thumb = find('thumb');
  // A preview has no value: the thumb sits halfway
  const fraction = 0.5;
  if (vertical) {
    const middle = top + (bottom - top) * (1 - fraction);
    if (empty) drawPart(empty, left, top, right - left, middle - top);
    if (filled) drawPart(filled, left, middle, right - left, bottom - middle);
    if (thumb) drawPart(thumb, (left + right - SLIDER_THUMB[1]) / 2, middle - SLIDER_THUMB[0] / 2, SLIDER_THUMB[1], SLIDER_THUMB[0]);
    return;
  }
  const extent = extentOf(filled, extentOf(empty, [6, 24]));
  const segment = extent[0] > 0 ? extent[0] : 6;
  const width = right - left;
  const filledTo = left + fraction * width;
  const starts = [];
  for (let start = left; start + segment < right && starts.length < 4096; start += segment + SEGMENT_GAP) starts.push(start);
  const covered = starts.length ? starts[starts.length - 1] + segment - left : 0;
  const shift = (width - covered) / 2;
  const y = (top + bottom) / 2 - extent[1] / 2;
  for (const start of starts) {
    const x = start + shift;
    if (outline) drawPart(outline, x, y, segment, extent[1]);
    const part = start <= filledTo ? filled : empty;
    if (part) drawPart(part, x, y, segment, extent[1]);
  }
  if (thumb) {
    const x = left + fraction * Math.max(0, width - SLIDER_THUMB[0]);
    drawPart(thumb, x, top + (SLIDER_THUMB[1] * 2) / 3, SLIDER_THUMB[0], SLIDER_THUMB[1]);
  }
};

const drawList = (box, parts, rect) => {
  const [left, top, right, bottom] = rect;
  const find = (role) => parts.find((part) => part.role === role);
  const [bw, bh] = SCROLL_BUTTON;
  const bar = parts.some((part) => ['up', 'down', 'track', 'thumb-top', 'thumb-middle', 'thumb-bottom'].includes(part.role));
  const textWidth = bar ? right - left - (bw + 3) : right - left;
  const body = find('body');
  if (body) drawPart(body, left, top, right - left, bottom - top);
  const selection = find('selection');
  if (selection) {
    const row = box.font ? box.font.size * POINTS_TO_UNITS + 2 : 16;
    drawPart(selection, left, top + 4, textWidth, Math.min(row, bottom - top - 4));
  }
  if (!bar) return;
  const x = right - bw - 2;
  const up = find('up');
  const down = find('down');
  const track = find('track');
  if (up) drawPart(up, x, top + 2, bw, bh);
  if (down) drawPart(down, x, bottom - bh - 2, bw, bh);
  const trackTop = top + bh + 3;
  const trackBottom = bottom - bh - 3;
  if (track) drawPart(track, x, trackTop, bw, trackBottom - trackTop);
  const topCap = find('thumb-top');
  const middle = find('thumb-middle');
  const bottomCap = find('thumb-bottom');
  const cap = (part) => {
    const extent = part && part.image && images[part.image] ? images[part.image].extent : undefined;
    return extent && extent[0] > 0 ? (extent[1] / extent[0]) * bw : 0;
  };
  const capTop = cap(topCap);
  const capBottom = cap(bottomCap);
  const thumbHeight = Math.max(THUMB_HEIGHT, capTop + capBottom);
  if (middle) drawPart(middle, x, trackTop + capTop, bw, Math.max(0, thumbHeight - capTop - capBottom));
  if (topCap) drawPart(topCap, x, trackTop, bw, capTop);
  if (bottomCap) drawPart(bottomCap, x, trackTop + thumbHeight - capBottom, bw, capBottom);
};

const lineBreaks = (text, width) => {
  const out = [];
  for (const paragraph of text.split(String.fromCharCode(10))) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && context.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
};

const drawText = (box, state, rect, textLeft) => {
  const text = box.shown;
  if (!text) return;
  const [left, top, right, bottom] = rect;
  const size = box.font ? box.font.size * POINTS_TO_UNITS : 12;
  const colour = box.textColors && box.textColors[state] && box.textColors[state][3] > 0 ? box.textColors[state] : [255, 255, 255, 255];
  context.font = (box.font && box.font.bold ? 'bold ' : '') + size + 'px ' + (box.font && box.font.name ? '"' + box.font.name + '", ' : '') + 'sans-serif';
  context.fillStyle = css(colour);
  context.textBaseline = 'middle';
  const start = textLeft === undefined ? left : textLeft;
  const centred = box.wrapCentered || box.type === 'PUSHBUTTON';
  const lines = box.wrapCentered || box.type === 'STATICTEXT' ? lineBreaks(text, right - start) : [text];
  const height = lines.length * size * 1.15;
  const middle = box.wrapCentered || box.type === 'PUSHBUTTON' || box.type === 'CHECKBOX' ? (top + bottom) / 2 : top + size * 0.65 + 2;
  const first = box.wrapCentered || box.type === 'PUSHBUTTON' || box.type === 'CHECKBOX' ? middle - height / 2 + size * 0.575 : middle;
  context.textAlign = centred ? 'center' : 'left';
  lines.forEach((line, index) => context.fillText(line, centred ? (start + right) / 2 : start + 3, first + index * size * 1.15));
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
};

const lookOf = (box) => {
  const state = stateSelect.value;
  const key = checkedBox.checked && box.looks[state + '+checked'] ? state + '+checked' : state;
  return box.looks[key] || [];
};

const drawBox = (box, depth) => {
  const [left, top, right, bottom] = box.rect;
  const width = right - left;
  const height = bottom - top;
  const state = stateSelect.value;
  const parts = lookOf(box);
  const type = box.type.toUpperCase();
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  let textLeft;
  if (type === 'CHECKBOX') {
    const side = Math.max(0, height - 2 * CHECK_INSET);
    for (const part of parts) drawPart(part, left, top + CHECK_INSET, side, side);
    textLeft = left + height;
  } else if (type === 'HORZSLIDER' || type === 'VERTSLIDER') {
    drawSlider(box, parts, box.rect, type === 'VERTSLIDER');
  } else if (type === 'SCROLLLISTBOX') {
    drawList(box, parts, box.rect);
  } else if (type === 'COMBOBOX') {
    for (const part of parts) {
      if (part.role === 'button') drawPart(part, right - Math.min(height, width), top, Math.min(height, width), height);
      else drawPart(part, left, top, width, height);
    }
  } else {
    for (const part of parts) drawPart(part, left, top, width, height);
  }
  if (type !== 'SCROLLLISTBOX' && type !== 'HORZSLIDER' && type !== 'VERTSLIDER') drawText(box, state, box.rect, textLeft);
  context.restore();
  if (showOutlines.checked || hover === box) {
    context.strokeStyle = hover === box ? '#ffd24a' : box.hidden ? 'rgba(255,255,255,0.25)' : box.laidOut ? 'rgba(255,170,90,0.6)' : 'rgba(200,220,255,0.3)';
    context.lineWidth = hover === box ? 2 : 1;
    context.setLineDash(box.hidden || box.laidOut ? [4, 3] : []);
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    context.setLineDash([]);
  }
};

const draw = () => {
  const roots = boxes.filter((box) => box.rect);
  const resolution = (roots.find((box) => box.resolution) || {}).resolution || [800, 600];
  canvas.width = resolution[0];
  canvas.height = resolution[1];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  placed = [];
  const walk = (list, depth, scale) => {
    for (const box of list) {
      if (box.hidden && !showHidden.checked) continue;
      if (box.rect) {
        context.save();
        context.scale(scale[0], scale[1]);
        drawBox(box, depth);
        context.restore();
        placed.push({ box, rect: [box.rect[0] * scale[0], box.rect[1] * scale[1], box.rect[2] * scale[0], box.rect[3] * scale[1]] });
      }
      walk(box.children, depth + 1, scale);
    }
  };
  // each root is scaled from its own creation resolution to the screen
  for (const root of boxes) {
    const own = root.resolution || resolution;
    walk([root], 0, [resolution[0] / own[0], resolution[1] / own[1]]);
  }
  const shown = hover;
  status.textContent = placed.length + ' windows at ' + resolution[0] + ' × ' + resolution[1] + (shown ? ' · ' + shown.name + ' (' + shown.type + ')' + (shown.image ? ' · ' + shown.image : '') + (shown.laidOut ? ' · placed by the engine' : '') : '');
};

const at = (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  let found;
  for (const entry of placed) {
    const [left, top, right, bottom] = entry.rect;
    if (x >= left && x <= right && y >= top && y <= bottom) found = entry;
  }
  return found;
};

canvas.addEventListener('mousemove', (event) => { const found = at(event); const box = found && found.box; if (box !== hover) { hover = box; draw(); } });
canvas.addEventListener('click', (event) => { const found = at(event); if (found) vscode.postMessage({ kind: 'reveal', offset: found.box.start }); });
for (const control of [showHidden, showOutlines, stateSelect, checkedBox]) control.addEventListener('change', draw);
window.addEventListener('message', ({ data }) => {
  if (data.kind === 'layout') {
    boxes = data.boxes;
    images = data.images || images;
    hover = undefined;
    for (const [id, uri] of Object.entries(data.textures || {})) {
      const texture = new Image();
      texture.onload = draw;
      texture.src = uri;
      textures[id] = texture;
    }
    draw();
  }
});
vscode.postMessage({ kind: 'ready' });
`;
