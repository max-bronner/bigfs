import * as vscode from 'vscode';
import type { RegionsMessage } from '../../webview/preview/protocol';
import type { FindRegions } from './createRegionDiscovery';
import type { RegionKind } from './regionKind';

/** One open preview of a texture, which regions are sent to */
interface RegionView {
  decoded: readonly [number, number];
  post(message: RegionsMessage): void;
}

/** What the preview editor asks of the regions of the textures it shows */
export interface TextureRegions extends vscode.Disposable {
  /**
   * Starts sending a preview the regions of its texture, now and whenever
   * they change, and searches for what else uses the texture the first time
   * it is shown. The search stops when the last preview of the texture goes.
   */
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
  /** Set while the search for more regions runs */
  search?: vscode.CancellationTokenSource;
  /** Whether a search ran to its end, so a later preview does not run it again */
  searched: boolean;
}

/**
 * Creates the keeper of the regions shown over textures. It reads each region
 * from the document that defines it, so every preview of the texture
 * follows an edit made in the text editor, by undo included.
 */
export const createTextureRegions = (
  kinds: readonly RegionKind[],
  findRegions: FindRegions,
): TextureRegions => {
  const textures = new Map<string, TextureState>();

  const stateOf = (texture: vscode.Uri): TextureState => {
    const key = texture.toString();
    let state = textures.get(key);

    if (!state) {
      state = { views: new Set(), ids: new Set(), searched: false };
      textures.set(key, state);
    }
    return state;
  };

  const readRegions = async (
    ids: readonly string[],
    decoded: readonly [number, number],
  ) =>
    (
      await Promise.all(
        kinds.map((kind) =>
          kind
            .read(
              ids.filter((id) => kind.owns(id)),
              decoded,
            )
            .catch(() => []),
        ),
      )
    ).flat();

  const send = async (
    state: TextureState,
    view: RegionView,
    ids: readonly string[],
    append: boolean,
  ) =>
    view.post({
      kind: 'regions',
      regions: await readRegions(ids, view.decoded),
      append,
      selected: state.selected,
      loading: state.search !== undefined,
    });

  const sendAll = (state: TextureState) =>
    Promise.all([...state.views].map((view) => send(state, view, [...state.ids], false)));

  const search = (texture: vscode.Uri, state: TextureState) => {
    const source = new vscode.CancellationTokenSource();

    state.search = source;
    findRegions(
      texture,
      (ids) => {
        const added = ids.filter((id) => !state.ids.has(id));

        added.forEach((id) => state.ids.add(id));
        if (added.length && !source.token.isCancellationRequested) {
          void Promise.all(
            [...state.views].map((view) => send(state, view, added, true)),
          );
        }
      },
      source.token,
    )
      // A search that fails leaves what it found; nothing is reported to the user
      .catch(() => undefined)
      .finally(() => {
        state.searched = !source.token.isCancellationRequested;
        state.search = undefined;
        source.dispose();
        void sendAll(state);
        // A preview opened while this search was being stopped still wants one
        if (!state.searched && state.views.size) {
          search(texture, state);
        }
      });
  };

  const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
    const changed = event.document.uri.toString();

    for (const state of textures.values()) {
      if (
        [...state.ids].some(
          (id) =>
            kinds.find((kind) => kind.owns(id))?.documentOf(id)?.toString() ===
            changed,
        )
      ) {
        void sendAll(state);
      }
    }
  });

  return {
    dispose: () => {
      subscription.dispose();
      textures.forEach((state) => state.search?.cancel());
    },
    attach(texture, decoded, post) {
      const state = stateOf(texture);
      const view: RegionView = { decoded, post };

      state.views.add(view);
      if (!state.search && !state.searched) {
        search(texture, state);
      }
      void send(state, view, [...state.ids], false);
      return new vscode.Disposable(() => {
        state.views.delete(view);
        if (!state.views.size) {
          state.search?.cancel();
        }
      });
    },
    async edit(texture, id, rect) {
      const state = stateOf(texture);
      const kind = kinds.find((each) => each.owns(id));
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
