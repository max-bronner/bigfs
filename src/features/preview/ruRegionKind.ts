import * as vscode from 'vscode';
import {
  findRuStyleLines,
  formatRuStyle,
  getRunTextureBox,
  parseRu,
  setRunTextureBox,
} from '../../formats/apt/aptGeometry';
import type { RuRun, RuStyle } from '../../formats/apt/aptGeometry';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { isEditable, offerOverride } from '../../services/ini/archiveText';
import { applyRegionEdit } from './applyRegionEdit';
import type { RegionKind } from './regionKind';
import { getRuRegionId, parseRuRegionId } from './ruRegionId';
import type { RuSource } from './ruRegionId';

type TextureStyle = Extract<RuStyle, { kind: 'texture' }>;

/** A texture style of a `.ru` document: the run it belongs to and the document's lines */
interface RuTextureStyle {
  document: vscode.TextDocument;
  lines: string[];
  run: RuRun;
  style: TextureStyle;
}

const SKEW_LIMIT = 1e-6;

/** Reads the texture style on a line of a `.ru` document, or nothing when the line is not one or the file does not parse */
const readTextureStyle = async ({
  uri,
  line,
}: RuSource): Promise<RuTextureStyle | undefined> => {
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();

  try {
    const run = parseRu(text)[findRuStyleLines(text).indexOf(line)];

    return run?.style.kind === 'texture'
      ? { document, lines: text.split(/\r?\n/), run, style: run.style }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a mapping turns or skews the image instead of only scaling and moving it */
const isTurned = ({ transform: [, b, c] }: TextureStyle): boolean =>
  Math.abs(b) > SKEW_LIMIT || Math.abs(c) > SKEW_LIMIT;

/**
 * Creates the region kind of the texture styles in a shape's `.ru` file. The
 * box is where the style's points land on its texture; moving it rewrites
 * only that `s tc:` line, keeping any turn of the mapping, and leaves the
 * triangles and every other line as they were.
 */
export const createRuRegionKind = (archives: ArchiveModel): RegionKind => ({
  owns: (id) => parseRuRegionId(id) !== undefined,
  read: async (id) => {
    const source = parseRuRegionId(id);
    const found = source && (await readTextureStyle(source));
    const box = found && getRunTextureBox(found.run);

    if (!source || !found || !box) {
      return undefined;
    }

    const editable = isEditable(archives, source.uri);
    const turned = isTurned(found.style);

    return {
      id: getRuRegionId(source),
      label: `${source.uri.path.slice(source.uri.path.lastIndexOf('/') + 1)} · image #${found.style.character}`,
      group: 'Shape geometry',
      rect: box,
      rotated: turned,
      editable,
      note:
        [
          turned
            ? 'The mapping is turned: the box is the box around it, and moving it keeps the turn.'
            : '',
          editable
            ? 'Changes rewrite this style line of the .ru file; close the movie in the APT editor first, which holds its own copy.'
            : 'In a read-only archive: override the file in a folder to edit it.',
        ]
          .filter((each) => each)
          .join(' ') || undefined,
      source: { uri: source.uri.toString(), line: source.line },
    };
  },
  write: async (id, decoded, rect) => {
    const source = parseRuRegionId(id);
    const found = source && (await readTextureStyle(source));

    if (!source || !found) {
      return false;
    }
    if (!isEditable(archives, source.uri)) {
      await offerOverride(
        archives,
        [source.uri],
        'This geometry is in a read-only archive. Override the file in a folder to edit its texture region.',
      );
      return false;
    }

    const clamp = (value: number, limit: number) =>
      Math.min(limit, Math.max(0, value));
    const [left, right] = [rect[0], rect[2]]
      .map((edge) => clamp(edge, decoded[0]))
      .sort((x, y) => x - y);
    const [top, bottom] = [rect[1], rect[3]]
      .map((edge) => clamp(edge, decoded[1]))
      .sort((x, y) => x - y);
    const moved = setRunTextureBox(found.run, [left, top, right, bottom]);
    const original = found.lines[source.line];
    const change = new vscode.WorkspaceEdit();

    change.replace(
      source.uri,
      new vscode.Range(source.line, 0, source.line, original.length),
      `${/^\s*/.exec(original)?.[0] ?? ''}${formatRuStyle(moved.style)}`,
    );
    return applyRegionEdit(found.document, change, source.line);
  },
  documentOf: (id) => parseRuRegionId(id)?.uri,
});
