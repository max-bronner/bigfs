import type { ToolBox } from '../../core/toolRegistry';
import { describeError } from '../../core/errors';
import { toRenderObjectFile } from '../../formats/apt/aptView3d';
import { decompressEar, isEarWrapped } from '../../formats/refpack/refpack';
import { buildW3dScene } from '../../formats/w3d/w3dScene';
import { decodePng } from '../../node/png';
import type { LoadFile } from '../../formats/w3d/w3dScene';
import type { ToPage } from '../../webview/apt/protocol';

type RenderObjectAnswer = Omit<Extract<ToPage, { kind: 'renderObject' }>, 'kind'>;

/**
 * Finds the model a `View3D` surface names the way the W3D viewer does, by
 * file name through the game's load order, with its skeleton and textures. A
 * name that holds no model answers with why and never throws.
 */
export const resolveRenderObject = async (
  name: string,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<RenderObjectAnswer> => {
  const file = toRenderObjectFile(name);

  if (!file) {
    return { name, error: 'not a model name' };
  }
  try {
    const read = await loadFile(file);

    if (!read) {
      return { name, error: `${file} is not in the game` };
    }

    // The textures and skeleton are compressed the same way as the model
    const unwrap: LoadFile = async (fileName) => {
      const bytes = await loadFile(fileName);

      return bytes && (isEarWrapped(bytes) ? decompressEar(bytes) : bytes);
    };

    return {
      name,
      scene: await buildW3dScene(
        isEarWrapped(read) ? decompressEar(read) : read,
        unwrap,
        tools,
        decodePng,
      ),
    };
  } catch (error) {
    return { name, error: describeError(error) };
  }
};
