import { readWorkspaceText } from '../services/ini/workspaceText';
import type { SageDefinition, SageIniIndex } from '../services/ini/sageIniIndex';
import { hotkeyClashes, hotkeyOf } from '../game/ini-tools/hotkeys';

/**
 * A CommandSet as the player sees it: its numbered slots in order, each
 * with the button's icon, its label in game text, and the command it runs.
 * Shown in the hover of any CommandSet name.
 */

/** Columns of the hover's grid */
const COLUMNS = 5;
const ICON_SIZE = 40;

/** The `key = value` fields of a block's own lines */
const fieldsOf = (lines: string[]): Map<string, string> =>
  new Map(
    lines.flatMap((line) => {
      const match = /^\s*([\w]+)\s*=\s*([^;]*?)\s*(?:;.*)?$/.exec(line);

      return match ? [[match[1].toLowerCase(), match[2].trim()] as const] : [];
    }),
  );

export interface CommandSetSlot {
  slot: number;
  button: string;
}

/** The numbered slots of a CommandSet's lines, in slot order */
export const commandSetSlots = (lines: string[]): CommandSetSlot[] =>
  [...fieldsOf(lines)]
    .filter(([key, value]) => /^\d+$/.test(key) && value)
    .map(([key, value]) => ({
      slot: Number(key),
      button: value.split(/\s+/)[0],
    }))
    .sort((a, b) => a.slot - b.slot);

/** A slot's button as the game shows it */
export interface ResolvedSlot extends CommandSetSlot {
  defined: boolean;
  text?: string;
  hotkey?: string;
  command?: string;
  imageName?: string;
  grants?: string[];
  needs?: string[];
  needsAny?: boolean;
}

/** Reads the lines of definitions, each file once per call */
export const createLineReader = () => {
  const texts = new Map<string, Promise<string[]>>();

  return (place: SageDefinition): Promise<string[]> => {
    const key = place.uri.toString();
    let text = texts.get(key);

    if (!text) {
      text = readWorkspaceText(place.uri)
        .then((content) => content.split(/\r?\n/))
        // A file deleted since it was indexed reads as empty
        .catch(() => []);
      texts.set(key, text);
    }
    return text.then((lines) => lines.slice(place.line + 1, place.endLine));
  };
};

/** Lower case names of a field that lists several */
const namesOf = (value: string | undefined): string[] =>
  (value ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((name) => name && name !== 'none');

/** Each slot's button: its game text, hotkey, command and icon name */
export const resolveSlots = async (
  index: SageIniIndex,
  slots: CommandSetSlot[],
  linesOf: (place: SageDefinition) => Promise<string[]>,
): Promise<ResolvedSlot[]> =>
  Promise.all(
    slots.map(async (slot) => {
      const [place] = index.findDefinitions('CommandButton', slot.button);

      if (!place) {
        return { ...slot, defined: false };
      }

      const fields = fieldsOf(await linesOf(place));
      const label = fields.get('textlabel');
      const text = label ? index.findString(label)?.text : undefined;

      const gated = /\bNEED_UPGRADE\b/i.test(fields.get('options') ?? '');

      return {
        ...slot,
        defined: true,
        grants: [
          ...namesOf(fields.get('upgrade')),
          ...namesOf(fields.get('science')),
        ],
        needs: gated ? namesOf(fields.get('neededupgrade')) : [],
        needsAny: /^(yes|true|1)$/i.test(fields.get('neededupgradeany') ?? ''),
        text,
        hotkey: text ? hotkeyOf(text) : undefined,
        command: fields.get('command'),
        imageName: fields.get('buttonimage'),
      };
    }),
  );

const escape = (text: string) => text.replace(/[|<>*_`[\]\\]/g, '\\$&');

export const createCommandSetPreview = (
  index: SageIniIndex,
  previewImage?: (definition: SageDefinition) => Promise<string | undefined>,
) => {
  return async (definition: SageDefinition): Promise<string> => {
    const linesOf = createLineReader();
    const slots = await resolveSlots(
      index,
      commandSetSlots(await linesOf(definition)),
      linesOf,
    );
    const clashes = hotkeyClashes(slots);
    const cells = await Promise.all(
      slots.map(async (slot) => {
        if (!slot.defined) {
          return `**${slot.slot}**<br>${escape(slot.button)}<br>*not defined*`;
        }

        const [image] = slot.imageName
          ? index.findDefinitions('MappedImage', slot.imageName)
          : [];
        const picture = image && previewImage && (await previewImage(image));
        const uri =
          picture && /\((data:image\/png;base64,[^)]+)\)/.exec(picture)?.[1];
        const icon = uri
          ? `![${escape(slot.imageName!)}](${uri}|width=${ICON_SIZE},height=${ICON_SIZE})`
          : '▫';
        const text = escape((slot.text ?? slot.button).replace(/&(?!&)/, ''));
        const key = slot.hotkey
          ? clashes.has(slot.slot)
            ? ` ⚠ **${slot.hotkey}**, as slot ${clashes.get(slot.slot)!.join(', ')}`
            : ` [${slot.hotkey}]`
          : '';

        return `${icon}<br>**${slot.slot}** ${text}${key}<br><sub>${escape(slot.command ?? '')}</sub>`;
      }),
    );

    if (!cells.length) {
      return `\`${definition.name}\` — CommandSet with no slots`;
    }

    const rows: string[] = [];

    for (let start = 0; start < cells.length; start += COLUMNS) {
      const row = cells.slice(start, start + COLUMNS);

      rows.push(
        `| ${[...row, ...Array(COLUMNS - row.length).fill(' ')].join(' | ')} |`,
      );
    }

    return [
      `\`${definition.name}\` — CommandSet, ${slots.length} button${slots.length === 1 ? '' : 's'}`,
      '',
      `|${' |'.repeat(COLUMNS)}`,
      `|${' --- |'.repeat(COLUMNS)}`,
      ...rows,
    ].join('\n');
  };
};
