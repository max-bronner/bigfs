import * as vscode from 'vscode';
import {
  findRuStyleLines,
  formatRuStyle,
  getRunTextureBox,
  parseRu,
  setRunTextureBox,
} from '../../formats/apt/aptGeometry';
import type {
  RuRun,
  RuStyle,
  TextureBox,
} from '../../formats/apt/aptGeometry';
import type { TextureRegion } from '../../webview/preview/protocol';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { isEditable, offerOverride } from '../../services/ini/archiveText';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import { applyRegionEdit } from './applyRegionEdit';
import type { RegionKind } from './regionKind';
import { getRuRegionId, parseRuRegionId } from './ruRegionId';
import type { RuSource } from './ruRegionId';

type TextureStyle = Extract<RuStyle, { kind: 'texture' }>;

/** A `.ru` document read once: its lines, the runs they make and the line of each run's style */
interface RuDocument {
  lines: string[];
  runs: RuRun[];
  styleLines: number[];
}

/** A texture style of a `.ru` document and the run it belongs to */
interface RuTextureStyle {
  run: RuRun;
  style: TextureStyle;
}

const SKEW_LIMIT = 1e-6;

/** Reads a `.ru` file as it is now, an open editor's unsaved text included, or nothing when it cannot be read or does not parse */
const readRuDocument = async (
  uri: vscode.Uri,
): Promise<RuDocument | undefined> => {
  try {
    const text = await readWorkspaceText(uri);

    return {
      lines: text.split(/\r?\n/),
      runs: parseRu(text),
      styleLines: findRuStyleLines(text),
    };
  } catch {
    return undefined;
  }
};

/** Finds the texture style on a line of a read `.ru` document, or nothing when the line holds another style */
const findTextureStyle = (
  { runs, styleLines }: RuDocument,
  line: number,
): RuTextureStyle | undefined => {
  const run = runs[styleLines.indexOf(line)];

  return run?.style.kind === 'texture' ? { run, style: run.style } : undefined;
};

/** Describes a texture style as a region of the texture it samples */
const describeRegion = (
  archives: ArchiveModel,
  source: RuSource,
  style: TextureStyle,
  box: TextureBox,
): TextureRegion => {
  const editable = isEditable(archives, source.uri);
  const turned = isTurned(style);

  return {
    id: getRuRegionId(source),
    label: `${source.uri.path.slice(source.uri.path.lastIndexOf('/') + 1)} · image #${style.character}`,
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
  read: async (ids) => {
    const byDocument = new Map<string, RuSource[]>();

    for (const source of ids.flatMap((id) => parseRuRegionId(id) ?? [])) {
      const key = source.uri.toString();

      byDocument.set(key, [...(byDocument.get(key) ?? []), source]);
    }

    const regions = await Promise.all(
      [...byDocument.values()].map(async (sources) => {
        const document = await readRuDocument(sources[0].uri);

        return sources.flatMap((source) => {
          const found = document && findTextureStyle(document, source.line);
          const box = found && getRunTextureBox(found.run);

          return found && box
            ? [describeRegion(archives, source, found.style, box)]
            : [];
        });
      }),
    );

    return regions.flat();
  },
  write: async (id, decoded, rect) => {
    const source = parseRuRegionId(id);
    const ru = source && (await readRuDocument(source.uri));
    const found = source && ru && findTextureStyle(ru, source.line);

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
    const original = ru.lines[source.line];
    const change = new vscode.WorkspaceEdit();

    change.replace(
      source.uri,
      new vscode.Range(source.line, 0, source.line, original.length),
      `${/^\s*/.exec(original)?.[0] ?? ''}${formatRuStyle(moved.style)}`,
    );
    return applyRegionEdit(
      await vscode.workspace.openTextDocument(source.uri),
      change,
      source.line,
    );
  },
  documentOf: (id) => parseRuRegionId(id)?.uri,
});
