import * as vscode from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { RegionsMessage } from '../../webview/preview/protocol';
import {
  getMappedImageRegionId,
  parseMappedImageRegionId,
} from './mappedImageRegionId';
import type { MappedImageSource } from './mappedImageRegionId';
import { readMappedImageRegion } from './readMappedImageRegion';
import { writeMappedImageRegion } from './writeMappedImageRegion';

/** One open preview of a texture, which regions are sent to */
interface RegionView {
  decoded: readonly [number, number];
  post(message: RegionsMessage): void;
}

/** What the preview editor asks of the regions of the textures it shows */
export interface TextureRegions extends vscode.Disposable {
  /** Starts sending a preview the regions of its texture, now and whenever they change */
  attach(
    texture: vscode.Uri,
    decoded: readonly [number, number],
    post: (message: RegionsMessage) => void,
  ): vscode.Disposable;
  /** Writes a dragged box into the file that defines the region */
  edit(
    texture: vscode.Uri,
    id: string,
    rect: readonly [number, number, number, number],
  ): Promise<void>;
  /** Puts a `MappedImage` block among the regions of a texture and selects it in every preview of it */
  focus(texture: vscode.Uri, source: MappedImageSource): void;
}

/** What is known about one texture's regions */
interface TextureState {
  views: Set<RegionView>;
  sources: Map<string, MappedImageSource>;
  selected?: string;
}

/**
 * Creates the keeper of the regions shown over textures. It reads each region
 * from the document that defines it, so every preview of the texture
 * follows an edit made in the text editor, by undo included.
 */
export const createTextureRegions = (archives: ArchiveModel): TextureRegions => {
  const textures = new Map<string, TextureState>();

  const stateOf = (texture: vscode.Uri): TextureState => {
    const key = texture.toString();
    let state = textures.get(key);

    if (!state) {
      state = { views: new Set(), sources: new Map() };
      textures.set(key, state);
    }
    return state;
  };

  const send = async (state: TextureState, view: RegionView) => {
    const found = await Promise.all(
      [...state.sources.values()].map((source) =>
        readMappedImageRegion(archives, source, view.decoded).catch(
          () => undefined,
        ),
      ),
    );

    view.post({
      kind: 'regions',
      regions: found.flatMap((region) => region ?? []),
      selected: state.selected,
    });
  };

  const sendAll = (state: TextureState) =>
    Promise.all([...state.views].map((view) => send(state, view)));

  const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
    const changed = event.document.uri.toString();

    for (const state of textures.values()) {
      if ([...state.sources.values()].some((each) => each.uri.toString() === changed)) {
        void sendAll(state);
      }
    }
  });

  return {
    dispose: () => subscription.dispose(),
    attach(texture, decoded, post) {
      const state = stateOf(texture);
      const view: RegionView = { decoded, post };

      state.views.add(view);
      void send(state, view);
      return new vscode.Disposable(() => state.views.delete(view));
    },
    async edit(texture, id, rect) {
      const state = stateOf(texture);
      const source = parseMappedImageRegionId(id);
      const view = [...state.views][0];

      if (!source || !view || !state.sources.has(id)) {
        return;
      }
      state.selected = id;

      // A changed document refreshes the views by its own event; a refusal
      // leaves the box where the page dragged it, so it is drawn back
      if (!(await writeMappedImageRegion(archives, source, view.decoded, rect))) {
        await sendAll(state);
      }
    },
    focus(texture, source) {
      const state = stateOf(texture);
      const id = getMappedImageRegionId(source);

      state.sources.set(id, source);
      state.selected = id;
      void sendAll(state);
    },
  };
};
