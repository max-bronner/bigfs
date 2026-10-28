import { SCRIPT_TREE_SCRIPT } from '../scripts/scriptTreeScript';

/**
 * Page code of the map editor: the terrain as a shaded relief with objects,
 * waypoints and start positions over it, the map's settings and players,
 * and the placed objects with their properties. Changes go to the extension
 * as edits; it sends the map back.
 */
export const MAP_VIEW_SCRIPT = /* js */ `
${SCRIPT_TREE_SCRIPT}
const vscode = acquireVsCodeApi();
const TIMES = ['', 'Morning', 'Afternoon', 'Evening', 'Night'];
const state = { map: undefined, heights: undefined, selected: undefined, selectedArea: undefined, filter: '', layers: { objects: true, waypoints: true, links: true, starts: true, boundary: true, areas: true }, relief: undefined, readOnly: false, templates: [], mode: undefined, draft: [], drag: undefined, pendingSelect: undefined };
const PROPERTY_KEYS = ['uniqueID', 'objectLayer', 'objectInitialHealth', 'objectEnabled', 'objectIndestructible', 'objectUnsellable', 'objectPowered', 'objectRecruitableAI', 'objectTargetable', 'objectBasePriority', 'objectBasePhase', 'exportWithScript', 'alignToTerrain', 'objectPrototypeScale', 'objectName', 'originalOwner', 'waypointName', 'waypointPathLabel1', 'waypointPathLabel2', 'waypointPathLabel3', 'waypointPathBiDirectional'];
const WAYPOINT_TEMPLATE = '*Waypoints/Waypoint';
const ROTATE_STEP = Math.PI / 12;
const canvas = document.getElementById('terrain');
const context = canvas.getContext('2d');
const info = document.getElementById('info');
const objectList = document.getElementById('objects');
const objectDetails = document.getElementById('object');

const send = (edit) => {
  if (state.readOnly) { showNotice('This map is read-only: it is part of a game install'); return; }
  vscode.postMessage({ kind: 'edit', edit });
};

const fillList = (id, values) => {
  document.getElementById(id).replaceChildren(...values.map((value) => Object.assign(document.createElement('option'), { value })));
};
const ownerOf = (object) => {
  const entry = object.properties.find((candidate) => candidate.key === 'originalOwner');
  return entry ? String(entry.value.value) : '';
};

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
    box.disabled = state.readOnly;
    box.onchange = () => onCommit({ type: 'bool', value: box.checked });
    return box;
  }
  const field = element('input');
  field.value = value.type === 'real' ? String(Math.round(value.value * 1e6) / 1e6) : String(value.value);
  field.disabled = state.readOnly;
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
const dictTable = (entries, owner, removable) => {
  const table = element('table', undefined, 'dict');
  for (const entry of entries) {
    const row = element('tr');
    const key = element('td', entry.key, 'key');
    key.title = entry.value.type;
    const cell = element('td');
    cell.append(valueInput(entry, (value) => send({ kind: 'dict', owner, key: entry.key, value })));
    row.append(key, cell);
    if (removable && !state.readOnly) {
      const remove = element('button', '×', 'icon');
      remove.title = 'Remove ' + entry.key;
      remove.onclick = () => send({ kind: 'property', owner, key: entry.key, value: null });
      const end = element('td');
      end.append(remove);
      row.append(end);
    }
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
const idOf = (object) => {
  const entry = object.properties.find((candidate) => candidate.key === 'waypointID');
  return entry ? entry.value.value : undefined;
};
const waypointsById = () => {
  const found = new Map();
  for (const object of state.map.objects) {
    const id = isWaypoint(object) ? idOf(object) : undefined;
    if (id !== undefined && !found.has(id)) found.set(id, object);
  }
  return found;
};
const waypointLabel = (object) => nameOf(object) || '#' + idOf(object);

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

/** Canvas pixels to world units */
const unproject = (px, py) => {
  const heights = state.heights;
  const scale = canvas.width / heights.width;
  return [(px / scale - heights.border) * 10, ((canvas.height - py) / scale - heights.border) * 10];
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
    for (const [areaIndex, area] of (state.map.triggerAreas || []).entries()) {
      if (!area.points.length) continue;
      context.beginPath();
      area.points.forEach(([x, y], index) => {
        const [px, py] = project(x, y);
        if (index) context.lineTo(px, py); else context.moveTo(px, py);
      });
      context.closePath();
      const chosen = state.selectedArea === areaIndex;
      context.fillStyle = chosen ? 'rgba(180, 90, 255, 0.32)' : 'rgba(180, 90, 255, 0.18)';
      context.strokeStyle = chosen ? '#ffffff' : 'rgba(200, 130, 255, 0.9)';
      context.lineWidth = chosen ? 2 : 1;
      context.fill();
      context.stroke();
      context.lineWidth = 1;
      if (chosen) {
        context.fillStyle = '#ffffff';
        for (const [x, y] of area.points) {
          const [vx, vy] = project(x, y);
          context.fillRect(vx - 3, vy - 3, 6, 6);
        }
      }
      const [cx, cy] = project(area.points.reduce((sum, p) => sum + p[0], 0) / area.points.length, area.points.reduce((sum, p) => sum + p[1], 0) / area.points.length);
      context.fillStyle = '#e8d4ff';
      context.fillText(area.name, cx - context.measureText(area.name).width / 2, cy);
    }
  }
  if (state.layers.links && state.layers.waypoints) {
    const ids = waypointsById();
    const chosen = state.map.objects[state.selected];
    for (const link of state.map.waypointLinks || []) {
      const from = ids.get(link.from);
      const to = ids.get(link.to);
      if (!from || !to) continue;
      const [ax, ay] = project(from.x, from.y);
      const [bx, by] = project(to.x, to.y);
      const hot = chosen && (chosen === from || chosen === to);
      context.strokeStyle = hot ? '#ffd23f' : 'rgba(63, 169, 255, 0.55)';
      context.fillStyle = context.strokeStyle;
      context.lineWidth = hot ? 2 : 1;
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
      // An arrowhead half way along says which way the link runs
      const angle = Math.atan2(by - ay, bx - ax);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      context.beginPath();
      context.moveTo(mx + Math.cos(angle) * 6, my + Math.sin(angle) * 6);
      context.lineTo(mx + Math.cos(angle + 2.5) * 5, my + Math.sin(angle + 2.5) * 5);
      context.lineTo(mx + Math.cos(angle - 2.5) * 5, my + Math.sin(angle - 2.5) * 5);
      context.fill();
      context.lineWidth = 1;
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
  if (state.mode && state.mode.kind === 'area' && state.draft.length) {
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.setLineDash([4, 3]);
    context.beginPath();
    state.draft.forEach(([x, y], index) => {
      const [px, py] = project(x, y);
      if (index) context.lineTo(px, py); else context.moveTo(px, py);
    });
    context.stroke();
    context.setLineDash([]);
    for (const [x, y] of state.draft) {
      const [px, py] = project(x, y);
      context.fillRect(px - 3, py - 3, 6, 6);
    }
  }
};

const parseValue = (type, text) => {
  if (type === 'bool') {
    if (['true', '1', 'yes'].includes(text.toLowerCase())) return { type, value: true };
    if (['false', '0', 'no'].includes(text.toLowerCase())) return { type, value: false };
    return undefined;
  }
  if (type === 'int' || type === 'real') {
    const number = Number(text);
    if (text.trim() === '' || !Number.isFinite(number) || (type === 'int' && !Number.isInteger(number))) return undefined;
    return { type, value: number };
  }
  return { type, value: text };
};

const roundTo = (value) => Math.round(value * 100) / 100;

const selectArea = (index) => {
  state.selectedArea = index;
  state.selected = index === undefined ? state.selected : undefined;
  showInfo();
  showObjects();
  showObject();
  draw();
};

/** The trigger areas as a list; the chosen one is edited by name and points */
const areaSection = (areas) => {
  const section = element('details');
  section.append(element('summary', 'Trigger areas (' + areas.length + ')'));
  if (state.selectedArea !== undefined) section.open = true;
  if (!state.readOnly) {
    const add = element('button', 'New area');
    add.title = 'Click the map to place points, Enter to finish';
    add.onclick = () => setMode({ kind: 'area' });
    section.append(add);
  }
  areas.forEach((area, index) => {
    const row = element('div', area.name + ' · ' + area.points.length + ' points', 'object' + (state.selectedArea === index ? ' selected' : ''));
    row.onclick = () => selectArea(index);
    section.append(row);
    if (state.selectedArea !== index) return;
    const edit = (changes) => send({ kind: 'areaSet', index, ...changes });
    const name = element('input');
    name.value = area.name;
    name.disabled = state.readOnly;
    name.onchange = () => edit({ name: name.value });
    const nameRow = element('div', undefined, 'field');
    nameRow.append(element('label', 'Name'), name);
    section.append(nameRow);
    area.points.forEach(([x, y], at) => {
      const line = element('div', undefined, 'light');
      line.append(element('label', 'Point ' + (at + 1)));
      [x, y].forEach((value, axis) => {
        const input = element('input');
        input.value = String(roundTo(value));
        input.disabled = state.readOnly;
        input.onchange = () => {
          const number = Number(input.value);
          if (input.value.trim() === '' || !Number.isFinite(number)) { input.classList.add('invalid'); return; }
          const points = area.points.map((point) => point.slice());
          points[at][axis] = number;
          edit({ points });
        };
        line.append(input);
      });
      if (!state.readOnly) {
        const remove = element('button', '×', 'icon');
        remove.title = 'Remove point';
        remove.onclick = () => edit({ points: area.points.filter((_, other) => other !== at) });
        line.append(remove);
      }
      section.append(line);
    });
    if (!state.readOnly) {
      const bar = element('div');
      const more = element('button', 'Add point');
      more.title = 'Adds a point half way along the closing edge';
      more.onclick = () => {
        const first = area.points[0];
        const last = area.points[area.points.length - 1];
        edit({ points: [...area.points, [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]] });
      };
      const remove = element('button', 'Delete area');
      remove.onclick = () => { state.selectedArea = undefined; send({ kind: 'areaDelete', index }); };
      bar.append(more, remove);
      section.append(bar);
    }
  });
  return section;
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
    info.append(scriptTree(map.scripts, map.sides, { editable: !state.readOnly }));
  }
  if ((map.triggerAreas && map.triggerAreas.length) || !state.readOnly) {
    info.append(areaSection(map.triggerAreas || []));
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
  field.disabled = state.readOnly;
  field.onchange = () => {
    const number = Number(field.value);
    if (!Number.isFinite(number)) { field.classList.add('invalid'); return; }
    onCommit(number);
  };
  row.append(element('label', label), field);
  return row;
};

/** A text, whole number or real property the object may or may not have yet; empty removes it */
const propertyField = (object, label, key, type, list) => {
  const entry = object.properties.find((candidate) => candidate.key === key);
  const row = element('div', undefined, 'field');
  const field = element('input');
  if (list) field.setAttribute('list', list);
  field.value = entry ? String(entry.value.value) : '';
  field.placeholder = entry ? '' : 'not set';
  field.disabled = state.readOnly;
  field.onchange = () => {
    const owner = { object: object.index };
    if (field.value.trim() === '') { send({ kind: 'property', owner, key, value: null }); return; }
    const value = parseValue(entry ? entry.value.type : type, field.value);
    if (!value) { field.classList.add('invalid'); return; }
    send({ kind: 'property', owner, key, value });
  };
  row.append(element('label', label), field);
  return row;
};

const addPropertyRow = (object) => {
  const row = element('div', undefined, 'addproperty');
  const key = element('input');
  key.setAttribute('list', 'propertyKeys');
  key.placeholder = 'property';
  const type = element('select');
  for (const name of ['string', 'int', 'real', 'bool', 'wide']) type.append(element('option', name));
  const value = element('input');
  value.placeholder = 'value';
  const add = element('button', 'Add');
  add.onclick = () => {
    const parsed = parseValue(type.value, value.value);
    if (!key.value.trim() || !parsed) { (parsed ? key : value).classList.add('invalid'); return; }
    send({ kind: 'property', owner: { object: object.index }, key: key.value.trim(), value: parsed });
  };
  row.append(key, type, value, add);
  return row;
};

const toggleLink = (from, to, present) => send({ kind: 'waypointLink', from, to, present });

const waypointLinks = (object) => {
  const id = idOf(object);
  const section = element('div');
  if (id === undefined) return section;
  const ids = waypointsById();
  section.append(element('h3', 'Links'));
  const links = state.map.waypointLinks || [];
  const rows = [
    ...links.filter((link) => link.from === id).map((link) => ({ link, arrow: '→', other: ids.get(link.to), otherId: link.to })),
    ...links.filter((link) => link.to === id).map((link) => ({ link, arrow: '←', other: ids.get(link.from), otherId: link.from })),
  ];
  for (const { link, arrow, other, otherId } of rows) {
    const line = element('div', arrow + ' ' + (other ? waypointLabel(other) : 'missing #' + otherId), 'object');
    if (other) line.onclick = () => select(other.index);
    if (!state.readOnly) {
      const remove = element('button', '×', 'icon');
      remove.title = 'Remove this link';
      remove.onclick = (event) => { event.stopPropagation(); toggleLink(link.from, link.to, false); };
      line.append(remove);
    }
    section.append(line);
  }
  if (!rows.length) section.append(element('p', 'No links', 'muted'));
  if (!state.readOnly) {
    const target = element('select');
    for (const [otherId, other] of ids) if (otherId !== id) target.append(Object.assign(element('option', waypointLabel(other)), { value: String(otherId) }));
    const add = element('button', 'Link to');
    add.title = 'Alt-click a waypoint on the map does the same, and removes a link that is there';
    add.onclick = () => { if (target.value !== '') toggleLink(id, Number(target.value), true); };
    const bar = element('div', undefined, 'addproperty');
    bar.append(add, target);
    section.append(bar);
  }
  return section;
};

const rotateBy = (object, step) => {
  let angle = object.angle + step;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  send({ kind: 'object', index: object.index, angle });
};

const deleteSelected = () => {
  if (state.readOnly) return;
  if (state.selected !== undefined && state.map.objects[state.selected]) {
    const index = state.selected;
    state.selected = undefined;
    send({ kind: 'objectDelete', index });
  } else if (state.selectedArea !== undefined) {
    const index = state.selectedArea;
    state.selectedArea = undefined;
    send({ kind: 'areaDelete', index });
  }
};

const showObject = () => {
  const object = state.map.objects[state.selected];
  objectDetails.replaceChildren();
  if (!object) return;
  const waypoint = isWaypoint(object);
  objectDetails.append(element('h3', (waypoint ? 'Waypoint ' : 'Object ') + object.index));
  if (!state.readOnly) {
    const bar = element('div', undefined, 'toolbar');
    const left = element('button', '⟲ 15°');
    left.onclick = () => rotateBy(object, ROTATE_STEP);
    const right = element('button', '⟳ 15°');
    right.onclick = () => rotateBy(object, -ROTATE_STEP);
    const remove = element('button', 'Delete');
    remove.title = 'Delete key';
    remove.onclick = deleteSelected;
    bar.append(left, right, remove);
    objectDetails.append(bar);
  }
  const template = element('div', undefined, 'field');
  const templateField = element('input');
  templateField.setAttribute('list', 'templates');
  templateField.value = object.template;
  templateField.disabled = state.readOnly;
  templateField.onchange = () => send({ kind: 'object', index: object.index, template: templateField.value });
  template.append(element('label', 'Template'), templateField);
  objectDetails.append(
    template,
    numberField('X', object.x, (value) => send({ kind: 'object', index: object.index, x: value })),
    numberField('Y', object.y, (value) => send({ kind: 'object', index: object.index, y: value })),
    numberField('Z offset', object.z, (value) => send({ kind: 'object', index: object.index, z: value })),
    numberField('Angle °', object.angle * 180 / Math.PI, (value) => send({ kind: 'object', index: object.index, angle: value * Math.PI / 180 })),
    propertyField(object, 'Owner / team', 'originalOwner', 'string', 'owners'),
    propertyField(object, 'Health %', 'objectInitialHealth', 'int'),
    propertyField(object, waypoint ? 'Waypoint name' : 'Name', waypoint ? 'waypointName' : 'objectName', 'string'),
  );
  if (waypoint) objectDetails.append(waypointLinks(object));
  objectDetails.append(element('h3', 'Properties'), dictTable(object.properties, { object: object.index }, true));
  if (!state.readOnly) objectDetails.append(addPropertyRow(object));
};

const select = (index) => {
  state.selected = index;
  if (index !== undefined) state.selectedArea = undefined;
  showInfo();
  showObjects();
  showObject();
  draw();
};

const setMode = (mode) => {
  state.mode = mode;
  state.draft = [];
  canvas.style.cursor = mode ? 'copy' : 'crosshair';
  const hint = document.getElementById('hint');
  hint.textContent = !mode ? '' : mode.kind === 'place' ? 'Click the map to place ' + mode.template + ' · Esc cancels' : 'Click the map to add points · Enter finishes · Backspace removes the last · Esc cancels';
  document.getElementById('modebar').hidden = !mode;
  draw();
};

const finishArea = () => {
  if (!state.mode || state.mode.kind !== 'area') return;
  if (state.draft.length < 3) { showNotice('A trigger area has at least three points'); return; }
  const taken = new Set((state.map.triggerAreas || []).map((area) => area.name));
  let number = taken.size + 1;
  while (taken.has('Area ' + number)) number++;
  send({ kind: 'areaAdd', name: 'Area ' + number, points: state.draft });
  state.selectedArea = (state.map.triggerAreas || []).length;
  setMode(undefined);
};

const placeAt = (x, y) => {
  const mode = state.mode;
  const base = { kind: 'objectAdd', template: mode.template, x: roundTo(x), y: roundTo(y) };
  if (mode.waypoint) {
    const ids = [...waypointsById().keys()];
    const id = ids.length ? Math.max(...ids) + 1 : 1;
    base.properties = [{ key: 'waypointID', value: { type: 'int', value: id } }, { key: 'waypointName', value: { type: 'string', value: 'Waypoint ' + id } }];
  } else {
    base.properties = [{ key: 'objectInitialHealth', value: { type: 'int', value: 100 } }, { key: 'objectEnabled', value: { type: 'bool', value: true } }];
  }
  state.pendingSelect = state.map.objects.length;
  send(base);
  setMode(undefined);
};

const canvasPoint = (event) => {
  const rect = canvas.getBoundingClientRect();
  return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
};

const visible = (object) => isStart(object) ? state.layers.starts : isWaypoint(object) ? state.layers.waypoints : state.layers.objects;

const nearestObject = ([x, y]) => {
  let best, bestDistance = 100;
  for (const object of state.map.objects) {
    if (!visible(object)) continue;
    const [px, py] = project(object.x, object.y);
    const distance = (px - x) ** 2 + (py - y) ** 2;
    if (distance < bestDistance) { best = object; bestDistance = distance; }
  }
  return best;
};

const nearestVertex = ([x, y]) => {
  const area = (state.map.triggerAreas || [])[state.selectedArea];
  if (!area || !state.layers.areas) return undefined;
  let best, bestDistance = 64;
  area.points.forEach((point, index) => {
    const [px, py] = project(point[0], point[1]);
    const distance = (px - x) ** 2 + (py - y) ** 2;
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
};

const insidePolygon = ([x, y], points) => {
  let inside = false;
  for (let at = 0, back = points.length - 1; at < points.length; back = at++) {
    const [ax, ay] = points[at];
    const [bx, by] = points[back];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

canvas.addEventListener('mousedown', (event) => {
  if (!state.heights || event.button !== 0 || state.mode) return;
  const at = canvasPoint(event);
  const vertex = nearestVertex(at);
  if (vertex !== undefined && !state.readOnly) {
    state.drag = { kind: 'vertex', area: state.selectedArea, vertex, moved: false };
    return;
  }
  const object = nearestObject(at);
  const chosen = state.map.objects[state.selected];
  if (object && event.altKey && chosen && isWaypoint(chosen) && isWaypoint(object) && object !== chosen) {
    if (!state.readOnly) {
      const from = idOf(chosen);
      const to = idOf(object);
      const present = (state.map.waypointLinks || []).some((link) => link.from === from && link.to === to);
      toggleLink(from, to, !present);
    }
    return;
  }
  if (object) {
    select(object.index);
    if (!state.readOnly) state.drag = { kind: 'object', index: object.index, moved: false };
    return;
  }
  const world = unproject(at[0], at[1]);
  const index = state.layers.areas ? (state.map.triggerAreas || []).findIndex((area) => insidePolygon(world, area.points)) : -1;
  if (index >= 0) selectArea(index);
});

canvas.addEventListener('mousemove', (event) => {
  const drag = state.drag;
  if (!drag) return;
  const [x, y] = unproject(...canvasPoint(event));
  drag.moved = true;
  if (drag.kind === 'object') {
    const object = state.map.objects[drag.index];
    object.x = x;
    object.y = y;
  } else {
    state.map.triggerAreas[drag.area].points[drag.vertex] = [x, y];
  }
  draw();
});

window.addEventListener('mouseup', () => {
  const drag = state.drag;
  state.drag = undefined;
  if (!drag || !drag.moved) return;
  if (drag.kind === 'object') {
    const object = state.map.objects[drag.index];
    send({ kind: 'object', index: drag.index, x: roundTo(object.x), y: roundTo(object.y) });
  } else {
    const area = state.map.triggerAreas[drag.area];
    send({ kind: 'areaSet', index: drag.area, points: area.points.map(([x, y]) => [roundTo(x), roundTo(y)]) });
  }
});

canvas.addEventListener('click', (event) => {
  if (!state.heights || !state.mode || state.readOnly) return;
  const [x, y] = unproject(...canvasPoint(event));
  if (state.mode.kind === 'place') {
    placeAt(x, y);
  } else {
    state.draft.push([roundTo(x), roundTo(y)]);
    draw();
  }
});

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) return;
  if (event.key === 'Escape') {
    setMode(undefined);
  } else if (event.key === 'Enter') {
    finishArea();
  } else if (event.key === 'Backspace' && state.mode && state.mode.kind === 'area') {
    state.draft.pop();
    draw();
  } else if (event.key === 'Delete') {
    deleteSelected();
  } else if ((event.key === '[' || event.key === ']') && !state.readOnly) {
    const object = state.map.objects[state.selected];
    if (object) rotateBy(object, event.key === '[' ? ROTATE_STEP : -ROTATE_STEP);
  }
});

const showNotice = (message) => {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.hidden = false;
  setTimeout(() => { notice.hidden = true; }, 6000);
};

const templateInput = document.getElementById('template');
const startPlace = (waypoint) => {
  const template = waypoint ? WAYPOINT_TEMPLATE : templateInput.value.trim();
  if (!template) { showNotice('Pick an object template to place'); return; }
  setMode({ kind: 'place', template, waypoint });
};
document.getElementById('placeObject').onclick = () => startPlace(false);
document.getElementById('placeWaypoint').onclick = () => startPlace(true);
document.getElementById('finishMode').onclick = finishArea;
document.getElementById('cancelMode').onclick = () => setMode(undefined);
fillList('propertyKeys', PROPERTY_KEYS);

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
    state.readOnly = Boolean(data.readOnly);
    document.body.classList.toggle('readonly', state.readOnly);
    if (data.templates) fillList('templates', data.templates);
    if (data.heights) {
      state.heights = data.heights;
      state.relief = buildRelief(data.heights);
    }
    if (state.pendingSelect !== undefined) {
      if (state.map.objects.length > state.pendingSelect) select(state.pendingSelect);
      state.pendingSelect = undefined;
    }
    if (state.selected !== undefined && !state.map.objects[state.selected]) state.selected = undefined;
    if (state.selectedArea !== undefined && !(state.map.triggerAreas || [])[state.selectedArea]) state.selectedArea = undefined;
    fillList('owners', [...new Set([...state.map.objects.map(ownerOf).filter(Boolean), ...state.map.teams.map((team) => (team.find((entry) => entry.key === 'teamName') || { value: {} }).value.value).filter(Boolean)])].sort());
    showInfo();
    showObjects();
    showObject();
    draw();
  } else if (data.kind === 'notice' || data.kind === 'error') {
    showNotice(data.message);
  }
});

vscode.postMessage({ kind: 'ready' });
`;
