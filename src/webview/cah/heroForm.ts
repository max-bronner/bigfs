import { choice, create, field, row } from './fields';
import {
  describeBanner,
  describeBling,
  describeChecksum,
  describePoints,
  describePower,
  describeVersion,
} from './heroText';
import type { FromCahPage, HeroView } from './protocol';

const byId = (id: string): HTMLElement => document.getElementById(id)!;

const COLOR_NAMES = ['Primary', 'Secondary', 'Tertiary'];

/** Draws the whole form for a hero; every field posts its change through `post`. */
export const renderHero = (
  hero: HeroView,
  post: (message: FromCahPage) => void,
): void => {
  const readOnly = hero.readOnly;
  const banner = byId('banner');
  const notes = describeBanner(hero);

  banner.textContent = notes.join(' ');
  banner.hidden = !notes.length;

  byId('hero').replaceChildren(
    ...row(
      'Name',
      field(hero.name, readOnly, (value) => ({ kind: 'setName', value }), post),
    ),
    ...row(
      'Id',
      hero.id === undefined
        ? create('span', {
            className: 'muted',
            textContent: 'none before record version 7',
          })
        : field(hero.id, readOnly, (value) => ({ kind: 'setId', value }), post),
    ),
    ...row(
      'Class',
      hero.classes.length
        ? choice(
            hero.classes,
            hero.classIndex,
            readOnly,
            (value) => ({ kind: 'setClass', value }),
            post,
          )
        : field(
            hero.classIndex,
            readOnly,
            (value) => ({ kind: 'setClass', value }),
            post,
            'number',
          ),
    ),
    ...row(
      'Subclass',
      hero.subclasses.length
        ? choice(
            hero.subclasses,
            hero.subclassIndex,
            readOnly,
            (value) => ({ kind: 'setSubclass', value }),
            post,
          )
        : field(
            hero.subclassIndex,
            readOnly,
            (value) => ({ kind: 'setSubclass', value }),
            post,
            'number',
          ),
    ),
  );

  byId('colors').replaceChildren(
    ...COLOR_NAMES.flatMap((name, index) => {
      const color = hero.colors[index];
      const input = create('input', {
        type: 'color',
        value: color.hex,
        disabled: readOnly,
      });

      input.addEventListener('change', () =>
        post({ kind: 'setColor', index, value: input.value }),
      );
      return row(
        name,
        create(
          'span',
          {},
          input,
          create('span', {
            className: 'muted',
            textContent: ` ${color.hex}, alpha ${color.alpha}`,
          }),
        ),
      );
    }),
  );

  byId('points').textContent = describePoints(hero.points);

  byId('powers').replaceChildren(
    ...hero.powers.map((power) => {
      const used = power.button !== '';
      const button = field(
        power.button,
        readOnly,
        (value) => ({
          kind: 'setPower',
          index: power.slot,
          field: 'button',
          value,
        }),
        post,
      );

      if (used && power.buttonKnown === false) {
        button.title = 'No CommandButton of this name is in the INI index';
      }
      const clear = create('button', {
        textContent: '×',
        title: 'Clear this slot',
        disabled: readOnly || !used,
      });

      clear.addEventListener('click', () =>
        post({ kind: 'clearPower', index: power.slot }),
      );
      return create(
        'tr',
        {},
        create('td', { textContent: String(power.slot) }),
        create('td', {}, button),
        create(
          'td',
          {},
          field(
            power.level,
            readOnly,
            (value) => ({
              kind: 'setPower',
              index: power.slot,
              field: 'level',
              value,
            }),
            post,
            'number',
          ),
          create('span', { className: 'muted', textContent: ' slot ' }),
          field(
            power.commandSlot,
            readOnly,
            (value) => ({
              kind: 'setPower',
              index: power.slot,
              field: 'slot',
              value,
            }),
            post,
            'number',
          ),
        ),
        create('td', {
          className: used && power.buttonKnown === false ? 'bad' : 'muted',
          textContent: describePower(power),
        }),
        create('td', {}, clear),
      );
    }),
  );

  byId('blings').replaceChildren(
    ...hero.blings.map((bling) => {
      const remove = create('button', {
        textContent: '×',
        title: 'Remove this bling',
        disabled: readOnly,
      });

      remove.addEventListener('click', () =>
        post({ kind: 'removeBling', index: bling.at }),
      );
      return create(
        'tr',
        {},
        create(
          'td',
          {},
          field(
            bling.group,
            readOnly,
            (value) => ({
              kind: 'setBling',
              index: bling.at,
              field: 'group',
              value,
            }),
            post,
          ),
        ),
        create(
          'td',
          {},
          field(
            bling.index,
            readOnly,
            (value) => ({
              kind: 'setBling',
              index: bling.at,
              field: 'index',
              value,
            }),
            post,
            'number',
          ),
        ),
        create('td', {
          className: 'muted',
          textContent: describeBling(bling),
        }),
        create('td', {}, remove),
      );
    }),
  );
  (byId('addBling') as HTMLButtonElement).disabled = readOnly;

  const file = hero.file;

  byId('file').replaceChildren(
    ...row(
      'Record version',
      create('span', { textContent: describeVersion(hero.version) }),
    ),
    ...row('Object id', create('span', { textContent: String(hero.objectId) })),
    ...row(
      'System hero',
      create('span', {
        textContent: hero.isSystem === undefined ? 'n/a' : String(hero.isSystem),
      }),
    ),
    ...row(
      'Checksum (CRC-32)',
      create('span', { textContent: describeChecksum(file) }),
    ),
    ...(file.trailing
      ? row(
          'Trailing bytes',
          create('span', { textContent: `${file.trailing} (dropped on save)` }),
        )
      : []),
  );
};
