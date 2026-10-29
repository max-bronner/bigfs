import { shownArmor } from '../../game/objects/armorTable';
import type {
  ArmorTableMessage,
  FromArmorPage,
} from '../../game/objects/armorTable';
import { getVsCodeApi } from '../shared/vscodeApi';

/**
 * The armor table's page: armors down, damage types across, a cell an
 * input. A value the armor writes is plain; one it takes from DEFAULT is
 * greyed. Low percentages (resists) are tinted green, above 100 red.
 */

const vscode = getVsCodeApi<FromArmorPage>();
const table = document.getElementById('table') as HTMLTableElement;
const filter = document.getElementById('filter') as HTMLInputElement;
const summary = document.getElementById('summary')!;
let data: ArmorTableMessage | undefined;

const percent = (value: string | undefined) =>
  value === undefined ? undefined : Number(value.replace('%', ''));

const render = () => {
  if (!data) {
    return;
  }

  const needle = filter.value.toLowerCase();
  const rows = data.rows.filter((row) =>
    row.name.toLowerCase().includes(needle),
  );
  const head = document.createElement('tr');

  head.append(
    ...['Armor', ...data.types].map((text) => {
      const cell = document.createElement('th');

      cell.textContent = text;
      return cell;
    }),
  );
  table.replaceChildren(
    head,
    ...rows.map((row) => {
      const line = document.createElement('tr');
      const name = document.createElement('td');

      name.className = 'name';
      name.textContent = row.name;
      name.title = 'Show it in its file';
      name.onclick = () =>
        vscode.postMessage({ kind: 'reveal', armor: row.name });
      line.append(
        name,
        ...data!.types.map((type) => {
          const cell = document.createElement('td');
          const input = document.createElement('input');
          const { value: shown, inherited } = shownArmor(row, type);
          const value = percent(shown);

          input.value = shown;
          input.className = inherited ? 'inherited' : '';
          input.title = inherited
            ? row.cells.DEFAULT
              ? `From DEFAULT; typing writes ${type} for ${row.name}`
              : `The game's 100% for a type with no line; typing writes ${type} for ${row.name}`
            : `${row.name} against ${type}`;
          input.onchange = () =>
            vscode.postMessage({
              kind: 'set',
              armor: row.name,
              type,
              value: input.value,
            });
          cell.className =
            value === undefined
              ? ''
              : value < 100
                ? 'low'
                : value > 100
                  ? 'high'
                  : '';
          cell.append(input);
          return cell;
        }),
      );
      return line;
    }),
  );
  summary.textContent = `${rows.length} of ${data.rows.length} armors, ${data.types.length} damage types`;
};

filter.oninput = render;
window.addEventListener(
  'message',
  ({ data: message }: MessageEvent<ArmorTableMessage>) => {
    if (message.kind === 'table') {
      data = message;
      render();
    }
  },
);
vscode.postMessage({ kind: 'ready' });
