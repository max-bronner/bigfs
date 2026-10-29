import * as vscode from 'vscode';
import { decompileBlock } from '../../formats/apt/aptScript';
import { checkRuns, fitRunTo } from '../../formats/apt/aptGeometry';
import type { RuRun } from '../../formats/apt/aptGeometry';
import type { EntryLocator } from '../../services/entryLocator';
import type { FromPage, ToPage } from '../../webview/apt/protocol';
import { describeError } from '../../core/errors';
import type { AptDocument } from './aptDocument';
import {
  addScript,
  editDocument,
  editScript,
  removeCharacter,
} from './aptDocumentEdits';
import type { RecordChange } from './aptDocumentEdits';
import { keepEngineAnswers } from './aptEngineAnswers';
import type { AptLibrary } from './aptLibrary';
import { resolveMappedImages } from './aptMappedImages';
import type { AptGameServices, AptMovieImports } from './aptMovieImports';
import type { AptScripts } from './aptScripts';
import type { AptTextView } from './aptTextView';
import { APT_VIEW_TYPE } from './viewTypes';

/** One open page of the APT editor, and what its messages act through */
export interface AptPageSession {
  document: AptDocument;
  post(message: ToPage): Thenable<boolean>;
  /** Textures the page was sent, which it keeps */
  sentTextures: Set<string>;
  /** Movies the page was sent, by name, with the stamp each was built from */
  sentMovies: Map<string, string>;
  record: RecordChange;
  /** Marks the page as loaded and draws it */
  ready(): Promise<void>;
  imports: AptMovieImports;
  library: AptLibrary;
  game: AptGameServices;
  locator: EntryLocator;
  scriptTabs: AptScripts;
  textView: AptTextView;
}

type PageMessage<K extends FromPage['kind']> = Extract<FromPage, { kind: K }>;

/** What the editor does for each message a page sends, by its kind */
const HANDLERS: {
  [K in FromPage['kind']]: (
    message: PageMessage<K>,
    page: AptPageSession,
  ) => Promise<void>;
} = {
  ready: (_, page) => page.ready(),

  engineAnswers: (message, { document, game }) =>
    keepEngineAnswers(game.state, document.name, message.values),

  async script(message, { document, post }) {
    const block = Number(message.block);
    let script;

    try {
      script = decompileBlock(
        document.image.bytes,
        block,
        document.constFile.items,
      );
    } catch (error) {
      script = {
        text: `Cannot decode: ${describeError(error)}`,
        mode: 'listing' as const,
      };
    }

    await post({ kind: 'script', block, ...script });
  },

  async edit(message, { document, post, record }) {
    const result = await editDocument(record, document, message.edit);

    if (result.character !== undefined) {
      await post({ kind: 'select', character: result.character });
    }
  },

  async scriptEdit(message, { document, post, record }) {
    const block = await editScript(
      record,
      document,
      Number(message.block),
      String(message.text),
    );

    await post({
      kind: 'scriptSaved',
      block,
      previous: Number(message.block),
    });
  },

  async constEdit(message, { document, record }) {
    await record(document, 'constant', async () =>
      document.changeConstItem(message.change),
    );
  },

  async openTextView(_, { document, textView }) {
    await textView.open(document.uri);
  },

  async removeCharacter(message, { document, record }) {
    await removeCharacter(record, document, Number(message.id));
  },

  async manageMovie(message, { document }) {
    await vscode.commands.executeCommand(
      message.action === 'rename'
        ? 'bigfs.renameAptMovie'
        : 'bigfs.deleteAptMovie',
      document.uri,
    );
  },

  async openScript(message, { document, scriptTabs }) {
    await scriptTabs.open(
      document,
      Number(message.block),
      String(message.label),
    );
  },

  async addScript(message, { document, record, scriptTabs }) {
    const block = await addScript(record, document, message.to);

    await scriptTabs.open(document, block, String(message.label));
  },

  async geometry(message, { document, record }) {
    if (!checkRuns(message.runs)) {
      throw new Error('The geometry is not well formed');
    }
    await record(document, 'geometry', async () =>
      document.setGeometry(Number(message.shape), message.runs),
    );
  },

  async importTexture(message, { document, record }) {
    const pixels = new Uint8Array(message.pixels);

    await record(document, 'import texture', async () => {
      const image = await document.addTexture(
        Number(message.width),
        Number(message.height),
        pixels,
      );

      // Laid over the shape's run it was chosen for, in the same step
      if (message.assign && checkRuns(message.assign.runs)) {
        const runs: RuRun[] = message.assign.runs;
        const run = runs[Number(message.assign.run)];

        if (run && run.style.kind !== 'line') {
          runs[Number(message.assign.run)] = fitRunTo(run, image, [
            0,
            0,
            Number(message.width),
            Number(message.height),
          ]);
        }
        document.setGeometry(Number(message.assign.shape), runs);
      }
      return image;
    });
  },

  async loadMovie(message, { post, imports, sentTextures, sentMovies }) {
    await post(
      await imports.loadedMovie(String(message.name), sentTextures, sentMovies),
    );
  },

  async mappedImages(message, { post, game, locator, sentTextures }) {
    const names = Array.isArray(message.names)
      ? message.names.filter((n: unknown) => typeof n === 'string')
      : [];

    await post({
      kind: 'mappedImages',
      ...(await resolveMappedImages(names, game.index, locator, sentTextures)),
    });
  },

  async playSound(message, { document }) {
    // Only a click on a play button, or the checkbox that was ticked
    if (typeof message.name === 'string' && message.name) {
      void vscode.commands.executeCommand(
        'bigfs.playAudioEvent',
        message.name,
        document.uri.toString(),
      );
    }
  },

  async openMovie(message, { library }) {
    const location = await library.locate(String(message.name));

    if (!location) {
      throw new Error(`No install holds ${String(message.name)}.apt`);
    }
    await vscode.commands.executeCommand(
      'vscode.openWith',
      location.uri,
      APT_VIEW_TYPE,
    );
  },

  async openGeometry(message, { document }) {
    const relative = `${document.name}_geometry/${Number(message.geometry)}.ru`;

    await vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.joinPath(document.uri, '..', relative),
    );
  },
};

/**
 * Acts on a message a page sent. A message of no kind the editor knows is
 * ignored; one that fails is shown on the page as a notice, and a page that
 * could not be drawn at all shows the error instead of the movie.
 */
export const dispatchPageMessage = async (
  message: unknown,
  page: AptPageSession,
): Promise<void> => {
  const kind = (message as { kind?: unknown } | null | undefined)?.kind;

  if (typeof kind !== 'string' || !Object.hasOwn(HANDLERS, kind)) {
    return;
  }

  const handle = HANDLERS[kind as FromPage['kind']] as (
    message: FromPage,
    page: AptPageSession,
  ) => Promise<void>;

  try {
    await handle(message as FromPage, page);
  } catch (error) {
    await page.post({ kind: 'notice', message: describeError(error) });

    if (kind === 'ready') {
      await page.post({ kind: 'error', message: describeError(error) });
    }
  }
};
