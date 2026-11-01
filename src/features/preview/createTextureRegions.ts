import * as vscode from 'vscode';
import type { RegionsMessage } from '../../webview/preview/protocol';
import type { RegionKind } from './regionKind';

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
  /** Puts a region among those of a texture and selects it in every preview of it */
  focus(texture: vscode.Uri, id: string): void;
}

/** What is known about one texture's regions */
interface TextureState {
  views: Set<RegionView>;
  ids: Set<string>;
  selected?: string;
}

/**
 * Creates the keeper of the regions shown over textures. It reads each region
 * from the document that defines it, so every preview of the texture
 * follows an edit made in the text editor, by undo included.
 */
export const createTextureRegions = (
  kinds: readonly RegionKind[],
): TextureRegions => {
  const textures = new Map<string, TextureState>();
  const kindOf = (id: string) => kinds.find((each) => each.owns(id));

  const stateOf = (texture: vscode.Uri): TextureState => {
    const key = texture.toString();
    let state = textures.get(key);

    if (!state) {
      state = { views: new Set(), ids: new Set() };
      textures.set(key, state);
    }
    return state;
  };

  const send = async (state: TextureState, view: RegionView) => {
    const found = await Promise.all(
      [...state.ids].map((id) =>
        kindOf(id)
          ?.read(id, view.decoded)
          .catch(() => undefined),
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
      if (
        [...state.ids].some((id) => kindOf(id)?.documentOf(id)?.toString() === changed)
      ) {
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
      const kind = kindOf(id);
      const view = [...state.views][0];

      if (!kind || !view || !state.ids.has(id)) {
        return;
      }
      state.selected = id;

      // A changed document refreshes the views by its own event; a refusal
      // leaves the box where the page dragged it, so it is drawn back
      if (!(await kind.write(id, view.decoded, rect))) {
        await sendAll(state);
      }
    },
    focus(texture, id) {
      const state = stateOf(texture);

      state.ids.add(id);
      state.selected = id;
      void sendAll(state);
    },
  };
};
