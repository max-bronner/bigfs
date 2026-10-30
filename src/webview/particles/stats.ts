import { BATCH_LIMIT } from '../../formats/particles/particleSimulation';
import { drawStats } from './graphics';
import { $, state, world } from './page';

/**
 * How heavy the effect is: live particles and systems now, at their peak
 * and on average since it started, per system name, how much of the view
 * the billboards cover (at this camera), and its peak against the particle
 * count each detail level allows in the mod's own `StaticGameLOD` blocks.
 */

const panel = $('stats');

const totals = {
  frames: 0,
  sum: 0,
  peak: 0,
  peakFrame: 0,
  peakSystems: 0,
  peakFill: 0,
  /** Peak particles of one live system, by system name */
  perName: new Map<string, { live: number; peak: number }>(),
};

/** Resets the counts; called when the effect starts over */
export const resetStats = (): void => {
  totals.frames = 0;
  totals.sum = 0;
  totals.peak = 0;
  totals.peakFrame = 0;
  totals.peakSystems = 0;
  totals.peakFill = 0;
  totals.perName.clear();
};

/** Adds one simulated frame to the counts */
export const sampleStats = (): void => {
  const live = world.liveParticles;

  totals.frames++;
  totals.sum += live;
  if (live > totals.peak) {
    totals.peak = live;
    totals.peakFrame = world.frame;
  }
  totals.peakSystems = Math.max(totals.peakSystems, world.systems.length);
  totals.peakFill = Math.max(totals.peakFill, drawStats.fill);
  for (const entry of totals.perName.values()) {
    entry.live = 0;
  }
  for (const system of world.systems) {
    const entry = totals.perName.get(system.name) ?? { live: 0, peak: 0 };

    entry.live += system.particles.length;
    entry.peak = Math.max(entry.peak, system.particles.length);
    totals.perName.set(system.name, entry);
  }
};

const cell = (text: string, className = '') => {
  const element = document.createElement('td');

  element.textContent = text;
  element.className = className;
  return element;
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

let lastShown = 0;

/** Renders the counts into the stats panel, at most four times a second */
export const showStats = (now: number): void => {
  if (now - lastShown < 250 || !state.scene) {
    return;
  }
  lastShown = now;

  const average = totals.frames ? totals.sum / totals.frames : 0;
  const lines = [
    `now ${world.liveParticles} particles in ${plural(world.systems.length, 'system')} · ${drawStats.drawn} drawn · fill ×${drawStats.fill.toFixed(1)}`,
    `peak ${totals.peak} at frame ${totals.peakFrame} · ${plural(totals.peakSystems, 'system')} · fill ×${totals.peakFill.toFixed(1)}`,
    `average ${average.toFixed(0)} over ${totals.frames} frames`,
  ];
  const summary = document.createElement('div');

  summary.textContent = lines.join('\n');
  summary.className = 'stats-lines';

  const budgets = document.createElement('div');

  budgets.className = 'row';
  if (state.scene.budgets.length) {
    budgets.append(
      'Peak against MaxParticleCount:',
      ...state.scene.budgets.map(({ lod, max }) => {
        const tag = document.createElement('span');
        const over = totals.peak > max;

        tag.className = over ? 'over' : 'within';
        tag.textContent = `${lod} ${max} ${over ? '✗' : '✓'}`;
        tag.title = over
          ? `At ${lod} the game keeps ${max} particles; this effect peaks at ${totals.peak}`
          : `Within ${lod}'s ${max}`;
        return tag;
      }),
    );
  } else {
    budgets.append(
      'No StaticGameLOD with MaxParticleCount is indexed to compare against',
    );
    budgets.classList.add('muted');
  }

  const table = document.createElement('table');

  table.className = 'stats-table';
  for (const [name, { live, peak }] of [...totals.perName].sort(
    (a, b) => b[1].peak - a[1].peak,
  )) {
    const row = table.insertRow();

    row.append(
      cell(name),
      cell(String(live)),
      cell(
        String(peak) + (peak > BATCH_LIMIT ? ` (${BATCH_LIMIT} drawn)` : ''),
        peak > BATCH_LIMIT ? 'over' : '',
      ),
    );
  }
  if (totals.perName.size) {
    const head = table.createTHead().insertRow();

    head.append(cell('system'), cell('live'), cell('peak in one'));
  }
  panel.replaceChildren(summary, budgets, table);
};
