/** Page code of the preview; it has no backslashes, being in a template */
export const WND_PREVIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const canvas = document.getElementById('screen');
const context = canvas.getContext('2d');
const status = document.getElementById('status');
const showHidden = document.getElementById('hidden');
let boxes = [];
let placed = [];
let hover;

const draw = () => {
  const roots = boxes.filter((box) => box.rect);
  const resolution = (roots.find((box) => box.resolution) || {}).resolution || [800, 600];
  canvas.width = resolution[0];
  canvas.height = resolution[1];
  context.clearRect(0, 0, canvas.width, canvas.height);
  placed = [];
  const walk = (list, depth) => {
    for (const box of list) {
      if (box.hidden && !showHidden.checked) continue;
      if (box.rect) {
        const [left, top, right, bottom] = box.rect;
        const width = right - left;
        const height = bottom - top;
        const tone = box.color && box.color[3] > 0 ? 'rgba(' + box.color[0] + ',' + box.color[1] + ',' + box.color[2] + ',' + Math.min(0.55, box.color[3] / 255) + ')' : 'rgba(120,140,170,' + (0.08 + depth * 0.04) + ')';
        context.fillStyle = tone;
        context.fillRect(left, top, width, height);
        context.strokeStyle = hover === box ? '#ffd24a' : box.hidden ? 'rgba(255,255,255,0.25)' : 'rgba(200,220,255,0.7)';
        context.lineWidth = hover === box ? 2 : 1;
        context.setLineDash(box.hidden ? [4, 3] : []);
        context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
        context.setLineDash([]);
        context.fillStyle = 'rgba(255,255,255,0.85)';
        context.font = '11px sans-serif';
        const label = (box.text ? box.text : box.name.replace(/^.*:/, '')) || box.type;
        if (width > 30 && height > 12) context.fillText(label.slice(0, Math.max(3, Math.floor(width / 6))), left + 3, top + 12);
        placed.push(box);
      }
      walk(box.children, depth + 1);
    }
  };
  walk(boxes, 0);
  status.textContent = placed.length + ' windows at ' + resolution[0] + ' × ' + resolution[1] + (hover ? ' · ' + hover.name + ' (' + hover.type + ')' + (hover.image ? ' · ' + hover.image : '') : '');
};

const at = (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  let found;
  for (const box of placed) {
    const [left, top, right, bottom] = box.rect;
    if (x >= left && x <= right && y >= top && y <= bottom) found = box;
  }
  return found;
};

canvas.addEventListener('mousemove', (event) => { const found = at(event); if (found !== hover) { hover = found; draw(); } });
canvas.addEventListener('click', (event) => { const found = at(event); if (found) vscode.postMessage({ kind: 'reveal', offset: found.start }); });
showHidden.addEventListener('change', draw);
window.addEventListener('message', ({ data }) => { if (data.kind === 'layout') { boxes = data.boxes; hover = undefined; draw(); } });
vscode.postMessage({ kind: 'ready' });
`;
