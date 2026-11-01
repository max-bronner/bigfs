import { getVsCodeApi } from '../shared/vscodeApi';
import { storeTextures } from './movieLoads';
import type { FromPage, PageMappedImage, ToPage } from './protocol';
import { state } from './state';

const vscode = getVsCodeApi<FromPage>();

/**
 * The `MappedImage`s image surfaces name, asked of the editor once each and
 * kept: an image the INI does not define is remembered as missing, so a
 * surface naming it draws a placeholder instead of asking every frame.
 */

const known = new Map<string, PageMappedImage | null>();
const asked = new Set<string>();
let queued: string[] = [];
let arrived: () => void = () => {};

/** Sets the callback run each time the editor answers with mapped images */
export const onMappedImages = (run: () => void): void => {
  arrived = run;
};

/**
 * Gets the mapped image of a name, asking the editor for it on first use:
 * undefined while it has not answered, null when the INI does not define it.
 */
export const getMappedImage = (name: string): PageMappedImage | null | undefined => {
  const key = name.toLowerCase();

  if (!known.has(key) && !asked.has(key)) {
    asked.add(key);
    queued.push(name);
    queueMicrotask(() => {
      if (queued.length) {
        vscode.postMessage({ kind: 'mappedImages', names: queued });
        queued = [];
      }
    });
  }
  return known.get(key);
};

/** Keeps JPEG textures as canvases, decoded here as the host has no decoder */
const storeJpegs = async (jpegs: Record<string, Uint8Array>): Promise<void> => {
  for (const [path, bytes] of Object.entries(jpegs)) {
    try {
      const bitmap = await createImageBitmap(
        new Blob([bytes as BlobPart], { type: 'image/jpeg' }),
      );
      const canvas = document.createElement('canvas');

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      state.textures.set(path, canvas);
    } catch {
      // The surface keeps its placeholder
    }
  }
};

/** Stores the editor's answer about mapped images and their textures, then redraws */
export const mappedImagesArrived = (
  data: Extract<ToPage, { kind: 'mappedImages' }>,
): void => {
  storeTextures(data.textures);
  for (const [name, image] of Object.entries(data.images)) {
    known.set(name.toLowerCase(), image);
  }
  arrived();
  void storeJpegs(data.jpegs ?? {}).then(arrived);
};
