import { getVsCodeApi } from '../shared/vscodeApi';
import type {
  FromSheetPage,
  SheetCell,
  SheetRow,
  ToSheetPage,
} from './protocol';

/**
 * The balance sheet's page: a sortable, filterable table of objects and
 * their numbers. Double-clicking a value the object or its weapon writes
 * edits it in place; the extension writes the file and sends the table back.
 */

const LABELS: Record<string, string> = {
  side: 'Side',
  cost: 'Cost',
  time: 'Build time',
  commandPoints: 'Command points',
  health: 'Health',
  vision: 'Vision',
  speed: 'Speed',
  armor: 'Armor',
  weapon: 'Weapon',
  damage: 'Damage',
  range: 'Range',
  delay: 'Delay',
  dps: 'Damage/s',
};
const PAGE = 400;

const vscode = getVsCodeApi<FromSheetPage>();
const $ = <Element extends HTMLElement>(id: string) =>
  document.getElementById(id) as Element;
const state = {
  rows: [] as SheetRow[],
  columns: [] as string[],
  sort: 'name',
  descending: false,
  shown: PAGE,
};

const parseNumber = (text: string) => {
  const value = Number(String(text).replace(/%$/, ''));

  return Number.isFinite(value) ? value : undefined;
};

const getCellValue = (row: SheetRow, column: string) =>
  column === 'name'
    ? row.name
    : ((row.cells as Record<string, SheetCell | undefined>)[column]?.value ??
      '');

const getVisibleRows = () => {
  const text = $<HTMLInputElement>('filter').value.toLowerCase();
  const side = $<HTMLSelectElement>('side').value;

  return state.rows.filter(
    (row) =>
      (!$<HTMLInputElement>('selectable').checked || row.selectable) &&
      (!$<HTMLInputElement>('buildable').checked || row.cells.cost) &&
      (!side || getCellValue(row, 'side') === side) &&
      (!text ||
        [row.name, getCellValue(row, 'weapon'), getCellValue(row, 'armor')].some((v) =>
          v.toLowerCase().includes(text),
        )),
  );
};

const compare = (a: SheetRow, b: SheetRow) => {
  const x = getCellValue(a, state.sort);
  const y = getCellValue(b, state.sort);
  const nx = parseNumber(x);
  const ny = parseNumber(y);
  let result: number;

  if (x === '' || y === '') {
    result = Number(x === '') - Number(y === '');
  } else if (nx !== undefined && ny !== undefined) {
    result = nx - ny;
  } else {
    result = String(x).localeCompare(String(y));
  }

  return state.descending && x !== '' && y !== '' ? -result : result;
};

const editCell = (
  td: HTMLTableCellElement,
  row: SheetRow,
  column: string,
  cell: SheetCell,
) => {
  const input = document.createElement('input');
  const written = cell.written ?? cell.value;
  let done = false;

  input.value = written;

  const finish = (save: boolean) => {
    if (done) {
      return;
    }

    done = true;

    if (save && input.value.trim() && input.value.trim() !== written) {
      td.textContent = `${input.value.trim()} …`;
      vscode.postMessage({
        kind: 'edit',
        row: row.name,
        column,
        old: written,
        value: input.value.trim(),
      });
    } else {
      td.textContent = cell.value;
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      finish(true);
    }

    if (event.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  td.replaceChildren(input);
  input.focus();
  input.select();
};

const createCellElement = (row: SheetRow, column: string) => {
  const td = document.createElement('td');
  const cell = (row.cells as Record<string, SheetCell | undefined>)[column];

  if (!cell) {
    return td;
  }

  td.textContent = cell.value;

  if (parseNumber(cell.value) !== undefined) {
    td.classList.add('number');
  }

  if (cell.derived) {
    td.classList.add('derived');
    td.title = cell.derived;
  } else if (cell.from) {
    td.classList.add('inherited');
    td.title = `From ${cell.from}; double-click to edit it there`;
  } else if (cell.shared && cell.shared > 1) {
    td.title = `Written in the weapon, which ${cell.shared} templates fire`;
  }

  if (cell.written) {
    td.title = `${td.title ? `${td.title}. ` : ''}Written as ${cell.written}`;
  }

  if (cell.uri) {
    td.classList.add('editable');
    td.ondblclick = () => editCell(td, row, column, cell);
  }

  return td;
};

const createRowElement = (row: SheetRow) => {
  const tr = document.createElement('tr');
  const name = document.createElement('td');

  name.className = 'name';
  name.textContent = row.name;
  name.title = `${row.keyword}${row.parent ? ` of ${row.parent}` : ''}. Click to open.`;
  name.onclick = () => vscode.postMessage({ kind: 'open', row: row.name });
  tr.append(name, ...state.columns.map((column) => createCellElement(row, column)));

  return tr;
};

const render = () => {
  $('head').replaceChildren(
    ...['name', ...state.columns].map((column) => {
      const th = document.createElement('th');

      th.textContent =
        (column === 'name' ? 'Name' : LABELS[column] || column) +
        (state.sort === column ? (state.descending ? ' ▼' : ' ▲') : '');
      th.onclick = () => {
        state.descending = state.sort === column ? !state.descending : false;
        state.sort = column;
        render();
      };

      return th;
    }),
  );

  const rows = getVisibleRows().sort(compare);

  $('count').textContent = `${rows.length} of ${state.rows.length} templates`;
  $('rows').replaceChildren(...rows.slice(0, state.shown).map(createRowElement));
  $('more').textContent =
    rows.length > state.shown
      ? `Showing ${state.shown}; scroll to the end for more`
      : '';
};

for (const id of ['filter', 'side', 'selectable', 'buildable']) {
  $(id).addEventListener('input', () => {
    state.shown = PAGE;
    render();
  });
}

$('refresh').onclick = () => vscode.postMessage({ kind: 'refresh' });
window.addEventListener('scroll', () => {
  if (
    window.innerHeight + window.scrollY >= document.body.scrollHeight - 200 &&
    $('more').textContent
  ) {
    state.shown += PAGE;
    render();
  }
});

window.addEventListener('message', ({ data }: MessageEvent<ToSheetPage>) => {
  if (data.kind === 'loading') {
    $('count').textContent = 'Reading the definitions…';
  } else if (data.kind === 'rows') {
    state.rows = data.rows;
    state.columns = data.columns;

    const sides = [
      ...new Set(data.rows.map((row) => getCellValue(row, 'side')).filter(Boolean)),
    ].sort();
    const side = $<HTMLSelectElement>('side');
    const chosen = side.value;

    side.replaceChildren(
      new Option('All sides', ''),
      ...sides.map((each) => new Option(each, each)),
    );
    side.value = sides.includes(chosen) ? chosen : '';
    $('notice').textContent = '';
    render();
  } else if (data.kind === 'notice') {
    $('notice').textContent = data.message;
  }
});

vscode.postMessage({ kind: 'ready' });
