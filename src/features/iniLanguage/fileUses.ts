import * as vscode from 'vscode';
import { readObjectScene } from '../../game/objects/objectScene';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { FILE_USES } from '../../services/ini/sageIniIndex';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import { registerCommand } from '../../platform/commands';

/**
 * Where the INI files use a model or animation file, for viewers that
 * show it: `bigfs.findFileUses` lists the places, each with the object it
 * sits in, and `bigfs.findModelForAnimation` reads the model an object
 * plays an animation on, from the state that names it.
 */

/** One place an INI file uses a model or animation file, as `bigfs.findFileUses` returns it */
export interface FileUse {
  uri: string;
  line: number;
  field: string;
  /** The definition the line sits in */
  owner?: string;
}

/** Places listed at most; a shared model can be used hundreds of times */
const MAX_USES = 40;
const DEFINITION = /^\s*(\w+)\s+(\S+)/;
const TOP_LEVEL = /^\S/;

const findUses = async (index: SageIniIndex, fileName: string) => {
  await index.whenReady();
  return index.findReferences(FILE_USES, fileName).slice(0, MAX_USES);
};

/** Registers `bigfs.findFileUses` and `bigfs.findModelForAnimation` */
export const registerFileUses = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable[] => [
  registerCommand(
    'bigfs.findFileUses',
    async (fileName: string): Promise<FileUse[]> => {
      const texts = new Map<string, Promise<string[]>>();
      const linesOf = (uri: vscode.Uri) => {
        const key = uri.toString();

        if (!texts.has(key)) {
          texts.set(
            key,
            readWorkspaceText(uri).then((text) => text.split(/\r?\n/)),
          );
        }
        return texts.get(key)!;
      };

      return Promise.all(
        (await findUses(index, fileName)).map(async (use) => {
          const lines = await linesOf(use.uri);
          let at = use.line;

          // The definition is the top-level line at or above it
          while (at > 0 && !TOP_LEVEL.test(lines[at] ?? '')) {
            at--;
          }
          return {
            uri: use.uri.toString(),
            line: use.line,
            field: use.field,
            owner: DEFINITION.exec(lines[at] ?? '')
              ?.slice(1)
              .join(' '),
          };
        }),
      );
    },
  ),
  registerCommand(
    'bigfs.findModelForAnimation',
    async (fileName: string): Promise<string | undefined> => {
      const clip = fileName.toLowerCase().replace(/\.w3d$/, '');
      const schema = await documents.getSchema();

      for (const use of await findUses(index, fileName)) {
        const parsed = parseSageIni(
          (await readWorkspaceText(use.uri)).split(/\r?\n/),
          schema,
        );
        const scene = readObjectScene(
          {
            ...parsed,
            blocks: parsed.blocks.filter(
              (block) =>
                block.startLine <= use.line && use.line <= block.endLine,
            ),
          },
          schema,
          () => false,
          () => false,
        );
        const model = scene?.states.find((state) =>
          state.animations.some(
            (name) => name.toLowerCase().split('.').pop() === clip,
          ),
        )?.model;

        if (model) {
          return model;
        }
      }
      return undefined;
    },
  ),
];
