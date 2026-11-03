import { createChoiceSelect, create, createField, createFormRow } from './fields';
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

/** Renders the whole form for a hero; every field posts its change through `post` */
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
    ...createFormRow(
      'Name',
      createField(hero.name, readOnly, (value) => ({ kind: 'setName', value }), post),
    ),
    ...createFormRow(
      'Id',
      hero.id === undefined
        ? create('span', {
            className: 'muted',
            textContent: 'none before record version 7',
          })
        : createField(hero.id, readOnly, (value) => ({ kind: 'setId', value }), post),
    ),
    ...createFormRow(
      'Class',
      hero.classes.length
        ? createChoiceSelect(
            hero.classes,
            hero.classIndex,
            readOnly,
            (value) => ({ kind: 'setClass', value }),
            post,
          )
        : createField(
            hero.classIndex,
            readOnly,
            (value) => ({ kind: 'setClass', value }),
            post,
            'number',
          ),
    ),
    ...createFormRow(
      'Subclass',
      hero.subclasses.length
        ? createChoiceSelect(
            hero.subclasses,
            hero.subclassIndex,
            readOnly,
            (value) => ({ kind: 'setSubclass', value }),
            post,
          )
        : createField(
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
      return createFormRow(
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
      const button = createField(
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
          createField(
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
          createField(
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
          createField(
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
          createField(
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
    ...createFormRow(
      'Record version',
      create('span', { textContent: describeVersion(hero.version) }),
    ),
    ...createFormRow('Object id', create('span', { textContent: String(hero.objectId) })),
    ...createFormRow(
      'System hero',
      create('span', {
        textContent: hero.isSystem === undefined ? 'n/a' : String(hero.isSystem),
      }),
    ),
    ...createFormRow(
      'Checksum (CRC-32)',
      create('span', { textContent: describeChecksum(file) }),
    ),
    ...(file.trailing
      ? createFormRow(
          'Trailing bytes',
          create('span', { textContent: `${file.trailing} (dropped on save)` }),
        )
      : []),
  );
};
