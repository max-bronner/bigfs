import * as vscode from 'vscode';
import { decodeWindows1252 } from '../common/windows1252';
import type { SageDefinition, SageIniIndex } from './sageIniIndex';

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

const escape = (text: string) => text.replace(/[|<>*_`[\]\\]/g, '\\$&');

export const createCommandSetPreview = (
  index: SageIniIndex,
  previewImage?: (definition: SageDefinition) => Promise<string | undefined>,
) => {
  return async (definition: SageDefinition): Promise<string> => {
    const texts = new Map<string, Promise<string[]>>();
    const linesOf = (place: SageDefinition) => {
      const key = place.uri.toString();
      let text = texts.get(key);

      if (!text) {
        text = Promise.resolve(
          vscode.workspace.textDocuments
            .find((document) => document.uri.toString() === key)
            ?.getText() ??
            vscode.workspace.fs.readFile(place.uri).then(decodeWindows1252),
        ).then((content) => content.split(/\r?\n/));
        texts.set(key, text);
      }
      return text.then((lines) => lines.slice(place.line + 1, place.endLine));
    };

    const slots = commandSetSlots(await linesOf(definition));
    const cells = await Promise.all(
      slots.map(async ({ slot, button }) => {
        const [place] = index.findDefinitions('CommandButton', button);

        if (!place) {
          return `**${slot}**<br>${escape(button)}<br>*not defined*`;
        }

        const fields = fieldsOf(await linesOf(place));
        const label = fields.get('textlabel');
        const text = label ? index.findString(label)?.text : undefined;
        const imageName = fields.get('buttonimage');
        const [image] = imageName
          ? index.findDefinitions('MappedImage', imageName)
          : [];
        const picture = image && previewImage && (await previewImage(image));
        const uri =
          picture && /\((data:image\/png;base64,[^)]+)\)/.exec(picture)?.[1];
        const icon = uri
          ? `![${escape(imageName!)}](${uri}|width=${ICON_SIZE},height=${ICON_SIZE})`
          : '▫';

        return `${icon}<br>**${slot}** ${escape(text ?? button)}<br><sub>${escape(fields.get('command') ?? '')}</sub>`;
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
