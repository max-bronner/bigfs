import { createScriptTree } from '../shared/scriptTree';
import { element } from '../shared/element';
import type { MapActions } from './actions';
import { createAreaSection } from './areaPanel';
import { createDictTable } from './dictionary';
import { info } from './elements';
import { isStart, isWaypoint } from './mapModel';
import { sendEdit, vscode } from './messaging';
import { state } from './state';

/** Names of a day's four lights, indexed by the time-of-day code the map stores (1 to 4) */
export const TIME_OF_DAY_NAMES = ['', 'Morning', 'Afternoon', 'Evening', 'Night'];

/** Renders the left panel: the map's facts, world info, players, lights, teams, scripts, areas, chunks and problems */
export const showInfo = (actions: MapActions): void => {
  const map = state.map;
  // Sections stay open across a redraw, which follows every edit
  const open = new Set(
    Array.from(
      info.querySelectorAll('details[open] > summary'),
      (summary) => summary.textContent,
    ),
  );
  const scroll = info.scrollTop;

  info.replaceChildren();
  queueMicrotask(() => {
    info.querySelectorAll('details > summary').forEach((summary) => {
      if (open.has(summary.textContent)) {
        (summary.parentElement as HTMLDetailsElement).open = true;
      }
    });
    info.scrollTop = scroll;
  });
  const world = map.worldInfo;
  const title = world.find((entry) => entry.key === 'mapName');

  info.append(element('h2', title ? String(title.value.value) : 'Map'));
  const facts = element('dl');
  const fact = (term: string, text: string) =>
    facts.append(element('dt', term), element('dd', text));

  if (state.heights && state.relief) {
    const heights = state.heights;

    fact(
      'Size',
      `${heights.width} × ${heights.height} cells, border ${heights.border}`,
    );
    fact(
      'Playable',
      heights.boundaries.map(([x, y]) => `${x} × ${y}`).join(', ') || '—',
    );
    fact('Heights', `${state.relief.low} to ${state.relief.high}`);
  }
  fact('Objects', String(map.objects.filter((object) => !isWaypoint(object)).length));
  fact('Waypoints', String(map.objects.filter(isWaypoint).length));
  fact('Start positions', String(map.objects.filter(isStart).length));
  fact('Players', String(map.sides.length));
  fact(
    'Stored',
    map.compression === 'ear' ? 'compressed (RefPack)' : 'uncompressed',
  );
  info.append(facts);

  if (map.timeOfDay !== undefined) {
    const select = element('select');

    for (let code = 1; code <= 4; code++) {
      const option = element('option', TIME_OF_DAY_NAMES[code]);

      option.value = String(code);
      option.selected = code === map.timeOfDay;
      select.append(option);
    }
    if (![1, 2, 3, 4].includes(map.timeOfDay)) {
      select.prepend(element('option', `unknown (${map.timeOfDay})`));
    }
    select.onchange = () =>
      sendEdit({ kind: 'timeOfDay', value: Number(select.value) });
    const row = element('div', undefined, 'field');

    row.append(element('label', 'Time of day'), select);
    info.append(row);
  }

  info.append(element('h3', 'World info'), createDictTable(world, 'world'));
  map.sides.forEach((side, index) => {
    const nameEntry = side.find((entry) => entry.key === 'playerName');
    const details = element('details');

    details.append(
      element(
        'summary',
        `Player ${index + 1}${nameEntry && nameEntry.value.value ? ` · ${nameEntry.value.value}` : ' · neutral'}`,
      ),
      createDictTable(side, { side: index }),
    );
    info.append(details);
  });
  if (map.lights) {
    const lights = element('details');

    lights.append(element('summary', 'Lighting (terrain sun)'));
    map.lights.forEach((light, config) => {
      lights.append(element('h3', TIME_OF_DAY_NAMES[config + 1]));
      for (const field of ['ambient', 'color', 'direction'] as const) {
        const row = element('div', undefined, 'light');

        row.append(element('label', field));
        const values = light[field].slice();

        values.forEach((value, index) => {
          const input = element('input');

          input.value = String(Math.round(value * 1000) / 1000);
          input.onchange = () => {
            const number = Number(input.value);

            if (!Number.isFinite(number)) {
              input.classList.add('invalid');
              return;
            }
            values[index] = number;
            sendEdit({
              kind: 'light',
              config,
              field,
              value: values as [number, number, number],
            });
          };
          row.append(input);
        });
        lights.append(row);
      }
    });
    info.append(lights);
  }
  if (map.teams.length) {
    const teams = element('details');

    teams.append(element('summary', `Teams (${map.teams.length})`));
    map.teams.forEach((team, index) => {
      const name = team.find((entry) => entry.key === 'teamName');
      const one = element('details');

      one.append(
        element('summary', name ? String(name.value.value) : `Team ${index + 1}`),
        createDictTable(team, { team: index }),
      );
      teams.append(one);
    });
    info.append(teams);
  }
  if (map.scripts.some((list) => list.length)) {
    info.append(
      createScriptTree(map.scripts, map.sides, {
        editable: !state.readOnly,
        onPlaySound: (name) => vscode.postMessage({ kind: 'playSound', name }),
        onSetActive: (at, active) =>
          sendEdit({ kind: 'scriptActive', at, active }),
      }),
    );
  }
  if (map.triggerAreas.length || !state.readOnly) {
    info.append(createAreaSection(map.triggerAreas, actions));
  }
  const chunks = element('details');

  chunks.append(element('summary', `Chunks (${map.chunks.length})`));
  const table = element('table', undefined, 'dict');

  for (const chunk of map.chunks) {
    const row = element('tr');

    row.append(
      element('td', chunk.name, 'key'),
      element('td', `v${chunk.version} · ${chunk.size.toLocaleString()} bytes`),
    );
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
