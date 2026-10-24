/**
 * Page code of the map editor: the terrain as a shaded relief with objects,
 * waypoints and start positions over it, the map's settings and players,
 * and the placed objects with their properties. Changes go to the extension
 * as edits; it sends the map back.
 */
export const MAP_VIEW_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const TIMES = ['', 'Morning', 'Afternoon', 'Evening', 'Night'];
const state = { map: undefined, heights: undefined, selected: undefined, filter: '', layers: { objects: true, waypoints: true, starts: true, boundary: true, areas: true }, relief: undefined };
const canvas = document.getElementById('terrain');
const context = canvas.getContext('2d');
const info = document.getElementById('info');
const objectList = document.getElementById('objects');
const objectDetails = document.getElementById('object');

const send = (edit) => vscode.postMessage({ kind: 'edit', edit });

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** An editor for one dictionary value, committing on change */
const valueInput = (entry, onCommit) => {
  const value = entry.value;
  if (value.type === 'bool') {
    const box = element('input');
    box.type = 'checkbox';
    box.checked = value.value;
    box.onchange = () => onCommit({ type: 'bool', value: box.checked });
    return box;
  }
  const field = element('input');
  field.value = value.type === 'real' ? String(Math.round(value.value * 1e6) / 1e6) : String(value.value);
  field.onchange = () => {
    if (value.type === 'int' || value.type === 'real') {
      const number = Number(field.value);
      if (!Number.isFinite(number) || (value.type === 'int' && !Number.isInteger(number))) { field.classList.add('invalid'); return; }
      onCommit({ type: value.type, value: number });
    } else {
      onCommit({ type: value.type, value: field.value });
    }
  };
  return field;
};

/** A table of a dictionary's entries, each editable */
const dictTable = (entries, owner) => {
  const table = element('table', undefined, 'dict');
  for (const entry of entries) {
    const row = element('tr');
    const key = element('td', entry.key, 'key');
    key.title = entry.value.type;
    const cell = element('td');
    cell.append(valueInput(entry, (value) => send({ kind: 'dict', owner, key: entry.key, value })));
    row.append(key, cell);
    table.append(row);
  }
  if (!entries.length) {
    const row = element('tr');
    row.append(element('td', 'no properties', 'muted'));
    table.append(row);
  }
  return table;
};

const isWaypoint = (object) => object.template.toLowerCase() === '*waypoints/waypoint';
const nameOf = (object) => {
  const entry = object.properties.find((candidate) => candidate.key === 'waypointName' || candidate.key === 'objectName');
  return entry && entry.value.value ? String(entry.value.value) : '';
};
const isStart = (object) => isWaypoint(object) && /^Player_\\d+_Start$/i.test(nameOf(object));

/** Shades the height map once: height as brightness, lit from the north west */
const buildRelief = (heights) => {
  const { width, height, samples } = heights;
  const image = new ImageData(width, height);
  let low = Infinity, high = -Infinity;
  for (const sample of samples) { if (sample < low) low = sample; if (sample > high) high = sample; }
  const range = Math.max(1, high - low);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const here = samples[at];
      const west = samples[y * width + Math.max(0, x - 1)];
      const north = samples[Math.min(height - 1, y + 1) * width + x];
      const slope = ((here - west) + (here - north)) / range * 6;
      const level = 70 + (here - low) / range * 150 + slope * 60;
      const value = Math.max(0, Math.min(255, level));
      // Rows run south to north; the image runs top down
      const pixel = ((height - 1 - y) * width + x) * 4;
      image.data[pixel] = value * 0.85;
      image.data[pixel + 1] = value * 0.95;
      image.data[pixel + 2] = value * 0.75;
      image.data[pixel + 3] = 255;
    }
  }
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  surface.getContext('2d').putImageData(image, 0, 0);
  return { surface, low, high };
};

/** World units to canvas pixels */
const project = (x, y) => {
  const heights = state.heights;
  const scale = canvas.width / heights.width;
  const cellX = x / 10 + heights.border;
  const cellY = y / 10 + heights.border;
  return [cellX * scale, canvas.height - cellY * scale];
};

const draw = () => {
  const heights = state.heights;
  if (!heights) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const area = canvas.parentElement.getBoundingClientRect();
  const scale = Math.max(0.1, Math.min((area.width - 4) / heights.width, (area.height - 4) / heights.height));
  canvas.width = Math.round(heights.width * scale);
  canvas.height = Math.round(heights.height * scale);
  context.imageSmoothingEnabled = true;
  context.drawImage(state.relief.surface, 0, 0, canvas.width, canvas.height);
  if (state.layers.boundary) {
    context.strokeStyle = 'rgba(255, 220, 80, 0.9)';
    context.setLineDash([6, 4]);
    for (const [bx, by] of heights.boundaries) {
      const [left, bottom] = project(0, 0);
      const [right, top] = project(bx * 10, by * 10);
      context.strokeRect(left, top, right - left, bottom - top);
    }
    context.setLineDash([]);
  }
  if (state.layers.areas) {
    context.font = '11px sans-serif';
    for (const area of state.map.triggerAreas || []) {
      if (!area.points.length) continue;
      context.beginPath();
      area.points.forEach(([x, y], index) => {
        const [px, py] = project(x, y);
        if (index) context.lineTo(px, py); else context.moveTo(px, py);
      });
      context.closePath();
      context.fillStyle = 'rgba(180, 90, 255, 0.18)';
      context.strokeStyle = 'rgba(200, 130, 255, 0.9)';
      context.fill();
      context.stroke();
      const [cx, cy] = project(area.points.reduce((sum, p) => sum + p[0], 0) / area.points.length, area.points.reduce((sum, p) => sum + p[1], 0) / area.points.length);
      context.fillStyle = '#e8d4ff';
      context.fillText(area.name, cx - context.measureText(area.name).width / 2, cy);
    }
  }
  for (const object of state.map.objects) {
    const waypoint = isWaypoint(object);
    const start = waypoint && isStart(object);
    if (start ? !state.layers.starts : waypoint ? !state.layers.waypoints : !state.layers.objects) continue;
    const [px, py] = project(object.x, object.y);
    const selected = state.selected === object.index;
    context.fillStyle = selected ? '#ff4040' : start ? '#ff8c1a' : waypoint ? '#3fa9ff' : 'rgba(30, 30, 30, 0.75)';
    const radius = selected ? 5 : start ? 5 : waypoint ? 2.5 : 2;
    context.beginPath();
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.fill();
    if (start) {
      context.font = '11px sans-serif';
      context.fillStyle = '#fff';
      context.strokeStyle = '#000';
      context.lineWidth = 3;
      const label = nameOf(object).replace(/^Player_(\\d+)_Start$/i, 'P$1');
      context.strokeText(label, px + 6, py + 4);
      context.fillText(label, px + 6, py + 4);
      context.lineWidth = 1;
    }
  }
};

const showInfo = () => {
  const map = state.map;
  // Sections stay open across a redraw, which follows every edit
  const open = new Set(Array.from(info.querySelectorAll('details[open] > summary'), (summary) => summary.textContent));
  const scroll = info.scrollTop;
  info.replaceChildren();
  queueMicrotask(() => {
    info.querySelectorAll('details > summary').forEach((summary) => {
      if (open.has(summary.textContent)) summary.parentElement.open = true;
    });
    info.scrollTop = scroll;
  });
  const world = map.worldInfo || [];
  const title = world.find((entry) => entry.key === 'mapName');
  info.append(element('h2', title ? String(title.value.value) : 'Map'));
  const facts = element('dl');
  const fact = (term, text) => facts.append(element('dt', term), element('dd', text));
  if (state.heights) {
    const heights = state.heights;
    fact('Size', heights.width + ' × ' + heights.height + ' cells, border ' + heights.border);
    fact('Playable', heights.boundaries.map(([x, y]) => x + ' × ' + y).join(', ') || '—');
    fact('Heights', state.relief.low + ' to ' + state.relief.high);
  }
  fact('Objects', String(map.objects.filter((object) => !isWaypoint(object)).length));
  fact('Waypoints', String(map.objects.filter(isWaypoint).length));
  fact('Start positions', String(map.objects.filter(isStart).length));
  fact('Players', String(map.sides.length));
  fact('Stored', map.compression === 'ear' ? 'compressed (RefPack)' : 'uncompressed');
  info.append(facts);

  if (map.timeOfDay !== undefined) {
    const select = element('select');
    for (let code = 1; code <= 4; code++) {
      const option = element('option', TIMES[code]);
      option.value = String(code);
      option.selected = code === map.timeOfDay;
      select.append(option);
    }
    if (![1, 2, 3, 4].includes(map.timeOfDay)) select.prepend(element('option', 'unknown (' + map.timeOfDay + ')'));
    select.onchange = () => send({ kind: 'timeOfDay', value: Number(select.value) });
    const row = element('div', undefined, 'field');
    row.append(element('label', 'Time of day'), select);
    info.append(row);
  }

  info.append(element('h3', 'World info'), dictTable(world, 'world'));
  map.sides.forEach((side, index) => {
    const nameEntry = side.find((entry) => entry.key === 'playerName');
    const details = element('details');
    details.append(element('summary', 'Player ' + (index + 1) + (nameEntry && nameEntry.value.value ? ' · ' + nameEntry.value.value : ' · neutral')), dictTable(side, { side: index }));
    info.append(details);
  });
  if (map.lights) {
    const lights = element('details');
    lights.append(element('summary', 'Lighting (terrain sun)'));
    map.lights.forEach((light, config) => {
      lights.append(element('h3', TIMES[config + 1]));
      for (const field of ['ambient', 'color', 'direction']) {
        const row = element('div', undefined, 'light');
        row.append(element('label', field));
        const values = light[field].slice();
        values.forEach((value, index) => {
          const input = element('input');
          input.value = String(Math.round(value * 1000) / 1000);
          input.onchange = () => {
            const number = Number(input.value);
            if (!Number.isFinite(number)) { input.classList.add('invalid'); return; }
            values[index] = number;
            send({ kind: 'light', config, field, value: values });
          };
          row.append(input);
        });
        lights.append(row);
      }
    });
    info.append(lights);
  }
  if (map.teams && map.teams.length) {
    const teams = element('details');
    teams.append(element('summary', 'Teams (' + map.teams.length + ')'));
    map.teams.forEach((team, index) => {
      const name = team.find((entry) => entry.key === 'teamName');
      const one = element('details');
      one.append(element('summary', name ? String(name.value.value) : 'Team ' + (index + 1)), dictTable(team, { team: index }));
      teams.append(one);
    });
    info.append(teams);
  }
  if (map.scripts && map.scripts.some((list) => list.length)) {
    const scripts = element('details');
    const count = (nodes) => nodes.reduce((sum, node) => sum + (node.kind === 'group' ? count(node.children) : 1), 0);
    scripts.append(element('summary', 'Scripts (' + map.scripts.reduce((sum, list) => sum + count(list), 0) + ')'));
    const calls = (title, list) => list.length ? title + ' ' + list.map((call) => call.name + (call.parameters.length ? '(' + call.parameters.join(', ') + ')' : '')).join('; ') : '';
    const render = (nodes, parent) => {
      for (const node of nodes) {
        const box = element('input');
        box.type = 'checkbox';
        box.checked = node.active;
        box.title = 'Active';
        box.onchange = () => send({ kind: 'scriptActive', at: node.activeAt, active: box.checked });
        if (node.kind === 'group') {
          const group = element('details', undefined, 'script');
          const summary = element('summary');
          summary.append(box, document.createTextNode(' ' + node.name + (node.subroutine ? ' (subroutine)' : '')));
          group.append(summary);
          render(node.children, group);
          parent.append(group);
        } else {
          const item = element('div', undefined, 'script');
          const label = element('label');
          label.append(box, document.createTextNode(node.name + (node.oneShot ? ' · once' : '') + (node.subroutine ? ' · subroutine' : '') + (node.difficulties.length < 3 ? ' · ' + node.difficulties.join('/') : '')));
          if (node.comment) label.title = node.comment;
          const detail = element('div', [
            node.conditions.length ? 'IF ' + node.conditions.map((and) => and.map((call) => call.name + (call.parameters.length ? '(' + call.parameters.join(', ') + ')' : '')).join(' AND ')).join(' OR ') : '',
            calls('THEN', node.actions),
            calls('ELSE', node.actionsFalse),
          ].filter(Boolean).join(' · '), 'calls');
          item.append(label, detail);
          parent.append(item);
        }
      }
    };
    map.scripts.forEach((list, slot) => {
      if (!list.length) return;
      const side = map.sides[slot];
      const owner = side && side.find((entry) => entry.key === 'playerName');
      const player = element('details');
      player.append(element('summary', (owner && owner.value.value ? owner.value.value : 'Player ' + (slot + 1)) + ' (' + count(list) + ')'));
      render(list, player);
      scripts.append(player);
    });
    info.append(scripts);
  }
  if (map.triggerAreas && map.triggerAreas.length) {
    const areas = element('details');
    areas.append(element('summary', 'Trigger areas (' + map.triggerAreas.length + ')'));
    map.triggerAreas.forEach((area) => areas.append(element('div', area.name + ' · ' + area.points.length + ' points', 'muted')));
    info.append(areas);
  }
  const chunks = element('details');
  chunks.append(element('summary', 'Chunks (' + map.chunks.length + ')'));
  const table = element('table', undefined, 'dict');
  for (const chunk of map.chunks) {
    const row = element('tr');
    row.append(element('td', chunk.name, 'key'), element('td', 'v' + chunk.version + ' · ' + chunk.size.toLocaleString() + ' bytes'));
    table.append(row);
  }
  chunks.append(table);
  info.append(chunks);
  if (map.problems.length) {
    const problems = element('div', undefined, 'problems');
    map.problems.forEach((problem) => problems.append(element('p', problem)));
    info.append(problems);
  }
};

const showObjects = () => {
  const text = state.filter.toLowerCase();
  const matches = state.map.objects.filter((object) => !text || object.template.toLowerCase().includes(text) || nameOf(object).toLowerCase().includes(text));
  document.getElementById('objectCount').textContent = matches.length + ' of ' + state.map.objects.length;
  objectList.replaceChildren(...matches.slice(0, 500).map((object) => {
    const row = element('div', undefined, 'object' + (state.selected === object.index ? ' selected' : ''));
    row.append(element('span', object.template), element('span', nameOf(object), 'muted'));
    row.onclick = () => select(object.index);
    return row;
  }));
  if (matches.length > 500) objectList.append(element('p', 'Showing 500; filter to narrow.', 'muted'));
};

const numberField = (label, value, onCommit) => {
  const row = element('div', undefined, 'field');
  const field = element('input');
  field.value = String(Math.round(value * 1000) / 1000);
  field.onchange = () => {
    const number = Number(field.value);
    if (!Number.isFinite(number)) { field.classList.add('invalid'); return; }
    onCommit(number);
  };
  row.append(element('label', label), field);
  return row;
};

const showObject = () => {
  const object = state.map.objects[state.selected];
  objectDetails.replaceChildren();
  if (!object) return;
  objectDetails.append(element('h3', 'Object ' + object.index));
  const template = element('div', undefined, 'field');
  const templateField = element('input');
  templateField.value = object.template;
  templateField.onchange = () => send({ kind: 'object', index: object.index, template: templateField.value });
  template.append(element('label', 'Template'), templateField);
  objectDetails.append(
    template,
    numberField('X', object.x, (value) => send({ kind: 'object', index: object.index, x: value })),
    numberField('Y', object.y, (value) => send({ kind: 'object', index: object.index, y: value })),
    numberField('Z offset', object.z, (value) => send({ kind: 'object', index: object.index, z: value })),
    numberField('Angle °', object.angle * 180 / Math.PI, (value) => send({ kind: 'object', index: object.index, angle: value * Math.PI / 180 })),
    element('h3', 'Properties'),
    dictTable(object.properties, { object: object.index }),
  );
};

const select = (index) => {
  state.selected = index;
  showObjects();
  showObject();
  draw();
};

canvas.addEventListener('click', (event) => {
  if (!state.heights) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best, bestDistance = 64;
  for (const object of state.map.objects) {
    const [px, py] = project(object.x, object.y);
    const distance = (px - x) ** 2 + (py - y) ** 2;
    if (distance < bestDistance) { best = object; bestDistance = distance; }
  }
  if (best) select(best.index);
});

document.getElementById('filter').addEventListener('input', (event) => { state.filter = event.target.value; showObjects(); });
for (const name of Object.keys(state.layers)) {
  const box = document.getElementById('layer-' + name);
  box.checked = state.layers[name];
  box.onchange = () => { state.layers[name] = box.checked; draw(); };
}
new ResizeObserver(() => draw()).observe(canvas.parentElement);

window.addEventListener('message', ({ data }) => {
  if (data.kind === 'map') {
    state.map = data.map;
    if (data.heights) {
      state.heights = data.heights;
      state.relief = buildRelief(data.heights);
    }
    if (state.selected !== undefined && !state.map.objects[state.selected]) state.selected = undefined;
    showInfo();
    showObjects();
    showObject();
    draw();
  } else if (data.kind === 'notice' || data.kind === 'error') {
    const notice = document.getElementById('notice');
    notice.textContent = data.message;
    notice.hidden = false;
    if (data.kind === 'notice') setTimeout(() => { notice.hidden = true; }, 6000);
  }
});

vscode.postMessage({ kind: 'ready' });
`;
