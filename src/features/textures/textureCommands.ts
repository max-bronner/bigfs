import * as vscode from 'vscode';
import { toUri } from '../../services/archives/commandTarget';
import type { CommandTarget } from '../../services/archives/commandTarget';
import { decodeDds, decodeTga } from '../../formats/texture/textureTools';
import type { DecodedTexture } from '../../formats/texture/textureTools';
import {
  DdsFormat,
  encodeDds,
  encodeTga,
} from '../../formats/texture/textureEncode';
import { decodePng, encodePng } from '../../node/png';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';

/**
 * Texture round trips: export a TGA or DDS as PNG to edit anywhere, import a
 * PNG back over a texture in the texture's own format, and convert a PNG to
 * a game format. Each works on files loose or inside an archive.
 */

const resolveTargetUri = (target: CommandTarget): vscode.Uri | undefined =>
  toUri(target) ?? vscode.window.activeTextEditor?.document.uri;

const getFileName = (uri: vscode.Uri) =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1);

const decodeTexture = (uri: vscode.Uri, bytes: Uint8Array): DecodedTexture =>
  /\.dds$/i.test(uri.path) ? decodeDds(bytes) : decodeTga(bytes);

/** Encodes an image in the format a texture was stored in */
export const encodeLike = (
  image: { width: number; height: number; pixels: Uint8Array },
  original: DecodedTexture,
  isDds: boolean,
): Uint8Array => {
  if (!isDds) {
    return encodeTga(image, original.hasAlpha);
  }

  const format: DdsFormat = ['DXT1', 'DXT3', 'DXT5'].includes(original.format)
    ? (original.format as DdsFormat)
    : 'RGBA';

  return encodeDds(image, format, original.levels.length > 1);
};

/** Picks where an output file goes: beside a loose file, or where the user says for an archive entry */
const pickOutput = async (
  source: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> => {
  if (source.scheme === 'file') {
    return vscode.Uri.joinPath(source, '..', name);
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;

  return vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
    filters: { Images: [name.slice(name.lastIndexOf('.') + 1)] },
  });
};

const run = (task: () => Promise<void>) => async () => {
  try {
    await task();
  } catch (error) {
    void vscode.window.showErrorMessage(
      describeError(error),
    );
  }
};

/** Registers the PNG export, import and conversion commands for textures */
export const registerTextureCommands = (
  context: vscode.ExtensionContext,
): void => {
  context.subscriptions.push(
    registerCommand(
      'bigfs.exportPng',
      (target: CommandTarget) =>
        run(async () => {
          const source = resolveTargetUri(target);

          if (!source) {
            return;
          }

          const texture = decodeTexture(
            source,
            await vscode.workspace.fs.readFile(source),
          );
          const output = await pickOutput(
            source,
            getFileName(source).replace(/\.[^.]+$/, '.png'),
          );

          if (output) {
            await vscode.workspace.fs.writeFile(
              output,
              encodePng(texture.levels[0]),
            );
            void vscode.window.showInformationMessage(
              `Exported ${getFileName(output)}`,
            );
          }
        })(),
    ),
    registerCommand(
      'bigfs.importImage',
      (target: CommandTarget) =>
        run(async () => {
          const destination = resolveTargetUri(target);

          if (!destination) {
            return;
          }

          const original = decodeTexture(
            destination,
            await vscode.workspace.fs.readFile(destination),
          );
          const [picked] =
            (await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { 'PNG images': ['png'] },
            })) ?? [];

          if (!picked) {
            return;
          }

          const image = decodePng(await vscode.workspace.fs.readFile(picked));
          const [first] = original.levels;

          if (
            (image.width !== first.width || image.height !== first.height) &&
            (await vscode.window.showWarningMessage(
              `The image is ${image.width}×${image.height}; ${getFileName(destination)} is ${first.width}×${first.height}. Replace it anyway?`,
              { modal: true },
              'Replace',
            )) !== 'Replace'
          ) {
            return;
          }

          await vscode.workspace.fs.writeFile(
            destination,
            encodeLike(image, original, /\.dds$/i.test(destination.path)),
          );
          void vscode.window.showInformationMessage(
            `Replaced ${getFileName(destination)} (${original.format})`,
          );
        })(),
    ),
    registerCommand(
      'bigfs.convertPng',
      (target: CommandTarget) =>
        run(async () => {
          const source = resolveTargetUri(target);

          if (!source) {
            return;
          }

          const choice = await vscode.window.showQuickPick(
            [
              {
                label: 'TGA 32-bit',
                description: 'with alpha',
                extension: 'tga',
                encode: (image: Parameters<typeof encodePng>[0]) =>
                  encodeTga(image, true),
              },
              {
                label: 'TGA 24-bit',
                description: 'no alpha',
                extension: 'tga',
                encode: (image: Parameters<typeof encodePng>[0]) =>
                  encodeTga(image, false),
              },
              ...(['DXT1', 'DXT5', 'DXT3', 'RGBA'] as DdsFormat[]).map(
                (format) => ({
                  label: `DDS ${format}`,
                  description:
                    format === 'DXT1'
                      ? 'no or 1-bit alpha, mipmaps'
                      : format === 'RGBA'
                        ? 'uncompressed, mipmaps'
                        : 'with alpha, mipmaps',
                  extension: 'dds',
                  encode: (image: Parameters<typeof encodePng>[0]) =>
                    encodeDds(image, format, true),
                }),
              ),
            ],
            { placeHolder: 'Convert to' },
          );

          if (!choice) {
            return;
          }

          const image = decodePng(await vscode.workspace.fs.readFile(source));

          if (
            choice.extension === 'dds' &&
            (image.width & (image.width - 1) ||
              image.height & (image.height - 1))
          ) {
            void vscode.window.showWarningMessage(
              'DDS textures should be a power of two on each side; the game may not load this one.',
            );
          }

          const output = await pickOutput(
            source,
            getFileName(source).replace(/\.png$/i, `.${choice.extension}`),
          );

          if (output) {
            await vscode.workspace.fs.writeFile(output, choice.encode(image));
            void vscode.window.showInformationMessage(
              `Wrote ${getFileName(output)}`,
            );
          }
        })(),
    ),
  );
};
