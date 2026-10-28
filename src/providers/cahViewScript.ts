/**
 * Page code of the hero file editor: the hero as a form. The extension owns
 * the data; the page sends each change and is sent the hero back.
 */
export const CAH_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const send = (message) => vscode.postMessage(message);

const el = (tag, props, ...children) => {
  const node = Object.assign(document.createElement(tag), props || {});
  node.append(...children);
  return node;
};

/** A field that sends its value when changed */
const field = (value, readOnly, kind, extra, type) => {
  const input = el('input', { value: String(value ?? ''), type: type || 'text', disabled: readOnly });
  input.addEventListener('change', () => send({ kind, value: input.value, ...extra }));
  return input;
};

const choice = (options, value, readOnly, kind) => {
  const select = el('select', { disabled: readOnly });
  const known = options.some((option) => option.index === value);
  if (!known) select.append(el('option', { value: String(value), textContent: value + ' (not in the INI)' }));
  options.forEach((option) => select.append(el('option', { value: String(option.index), textContent: option.index + ': ' + option.label })));
  select.value = String(value);
  select.addEventListener('change', () => send({ kind, value: select.value }));
  return select;
};

const row = (label, node) => [el('div', { className: 'muted', textContent: label }), node];

const show = (hero) => {
  const ro = hero.readOnly;
  const banner = document.getElementById('banner');
  const notes = [];
  if (ro) notes.push('Read-only: this file belongs to a game install or a read-only source. Use Save As to keep an edited copy.');
  if (!hero.hasSystem) notes.push('No CreateAHeroSystem was found in the INI files, so classes, bling and powers are shown as stored.');
  if (hero.file.storedCrc !== undefined && !hero.file.document) notes.push('The stored checksum does not match the file; the game would drop this hero. Saving writes the correct one.');
  banner.textContent = notes.join(' ');
  banner.hidden = !notes.length;

  const heroGrid = document.getElementById('hero');
  heroGrid.replaceChildren(
    ...row('Name', field(hero.name, ro, 'setName')),
    ...row('Id', hero.id === undefined ? el('span', { className: 'muted', textContent: 'none before record version 7' }) : field(hero.id, ro, 'setId')),
    ...row('Class', hero.classes.length ? choice(hero.classes, hero.classIndex, ro, 'setClass') : field(hero.classIndex, ro, 'setClass', {}, 'number')),
    ...row('Subclass', hero.subclasses.length ? choice(hero.subclasses, hero.subclassIndex, ro, 'setSubclass') : field(hero.subclassIndex, ro, 'setSubclass', {}, 'number')),
  );

  document.getElementById('colors').replaceChildren(...['Primary', 'Secondary', 'Tertiary'].flatMap((name, index) => {
    const color = hero.colors[index];
    const input = el('input', { type: 'color', value: color.hex, disabled: ro });
    input.addEventListener('change', () => send({ kind: 'setColor', index, value: input.value }));
    return row(name, el('span', {}, input, el('span', { className: 'muted', textContent: ' ' + color.hex + ', alpha ' + color.alpha })));
  }));

  document.getElementById('points').textContent = hero.points
    ? (hero.points.total === undefined ? 'The subclass does not say how many points it has.' : hero.points.spent + ' of ' + hero.points.total + ' spent') + ' (derived from the bling choices; the file does not store points)'
    : 'Not stored in the file; shown when the class and subclass resolve.';

  document.getElementById('powers').replaceChildren(...hero.powers.map((power) => {
    const used = power.button !== '';
    const detail = [power.label, power.specialPower && ('special power ' + power.specialPower + (power.specialPowerKnown === false ? ' (not found)' : ''))].filter(Boolean).join(', ');
    const button = field(power.button, ro, 'setPower', { index: power.slot, field: 'button' });
    if (used && power.buttonKnown === false) button.title = 'No CommandButton of this name is in the INI index';
    const clear = el('button', { textContent: '×', title: 'Clear this slot', disabled: ro || !used });
    clear.addEventListener('click', () => send({ kind: 'clearPower', index: power.slot }));
    return el('tr', {},
      el('td', { textContent: String(power.slot) }),
      el('td', {}, button),
      el('td', {}, field(power.level, ro, 'setPower', { index: power.slot, field: 'level' }, 'number'), el('span', { className: 'muted', textContent: ' slot ' }), field(power.commandSlot, ro, 'setPower', { index: power.slot, field: 'slot' }, 'number')),
      el('td', { className: used && power.buttonKnown === false ? 'bad' : 'muted', textContent: detail }),
      el('td', {}, clear));
  }));

  document.getElementById('blings').replaceChildren(...hero.blings.map((bling) => {
    const remove = el('button', { textContent: '×', title: 'Remove this bling', disabled: ro });
    remove.addEventListener('click', () => send({ kind: 'removeBling', index: bling.at }));
    const text = [bling.binder, bling.kind, bling.upgrade, bling.label].filter(Boolean).join(' - ');
    return el('tr', {},
      el('td', {}, field(bling.group, ro, 'setBling', { index: bling.at, field: 'group' })),
      el('td', {}, field(bling.index, ro, 'setBling', { index: bling.at, field: 'index' }, 'number')),
      el('td', { className: 'muted', textContent: text }),
      el('td', {}, remove));
  }));
  document.getElementById('addBling').disabled = ro;

  const f = hero.file;
  document.getElementById('file').replaceChildren(
    ...row('Record version', el('span', { textContent: hero.version + (hero.version < 8 ? ' (saving writes version 8)' : '') })),
    ...row('Object id', el('span', { textContent: String(hero.objectId) })),
    ...row('System hero', el('span', { textContent: hero.isSystem === undefined ? 'n/a' : String(hero.isSystem) })),
    ...row('Checksum (CRC-32)', el('span', { textContent: (f.storedCrc === undefined ? 'none stored' : 'stored ' + f.storedCrc.toString(16).padStart(8, '0')) + ', will save as ' + f.crc.toString(16).padStart(8, '0') })),
    ...(f.trailing ? row('Trailing bytes', el('span', { textContent: f.trailing + ' (dropped on save)' })) : []),
  );
};

document.getElementById('addBling').addEventListener('click', () => {
  send({ kind: 'addBling', value: 'NewGroup' });
});

window.addEventListener('message', ({ data }) => {
  if (data.kind === 'hero') {
    show(data);
  } else if (data.kind === 'notice') {
    const notice = document.getElementById('notice');
    notice.textContent = data.message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6000);
  }
});

send({ kind: 'ready' });
`;
