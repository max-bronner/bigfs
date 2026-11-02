import { Range, Uri, commands, window } from 'vscode';
import type { Disposable, ExtensionContext, WebviewView } from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getPageBundleFolder } from '../../platform/webview/pageBundle';
import type {
  FromSearchPage,
  ToSearchPage,
} from '../../webview/archiveSearch/protocol';
import { renderSearchPage } from './renderSearchPage';
import { runArchiveSearch } from './runArchiveSearch';

/** What the command that opens the search view can do to it */
export interface SearchViewHandle extends Disposable {
  /** Shows the view and puts the cursor in its search box, with `query` in it when given */
  focus(query?: string): Promise<void>;
}

/**
 * Creates the search view of the side bar: a webview that takes the query,
 * runs the search over the archives and draws the results as they stream in.
 */
export const createSearchView = (
  context: ExtensionContext,
  archives: ArchiveModel,
): SearchViewHandle => {
  let view: WebviewView | undefined;
  let waitingFocus: { query?: string } | undefined;
  /** Id of the search that may still post; a newer search or a cancel replaces it */
  let activeId = 0;

  const post = (message: ToSearchPage): void => {
    void view?.webview.postMessage(message);
  };

  const open = async (message: Extract<FromSearchPage, { kind: 'open' }>) => {
    try {
      await window.showTextDocument(Uri.parse(message.uri), {
        selection: new Range(
          message.line,
          message.start,
          message.line,
          message.end,
        ),
      });
    } catch (error) {
      void window.showErrorMessage(
        `Could not open the result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const onMessage = (message: FromSearchPage): void => {
    switch (message.kind) {
      case 'ready':
        if (waitingFocus) {
          post({ kind: 'focus', ...waitingFocus });
          waitingFocus = undefined;
        }
        break;
      case 'search': {
        const { id } = message;

        activeId = id;
        void runArchiveSearch(archives, id, message.request, {
          post: (outgoing) => {
            if (activeId === id) {
              post(outgoing);
            }
          },
          isCancelled: () => activeId !== id,
        });
        break;
      }
      case 'cancel':
        activeId = 0;
        break;
      case 'open':
        void open(message);
        break;
    }
  };

  const registration = window.registerWebviewViewProvider(
    'bigfs.search',
    {
      resolveWebviewView: (resolved) => {
        view = resolved;
        resolved.webview.options = {
          enableScripts: true,
          localResourceRoots: [getPageBundleFolder(context.extensionUri)],
        };
        resolved.webview.html = renderSearchPage(
          resolved.webview,
          context.extensionUri,
        );
        resolved.webview.onDidReceiveMessage(onMessage);
        resolved.onDidDispose(() => {
          activeId = 0;
          view = undefined;
        });
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  return {
    dispose: () => registration.dispose(),
    focus: async (query) => {
      if (view) {
        post({ kind: 'focus', query });
      } else {
        waitingFocus = { query };
      }

      await commands.executeCommand('bigfs.search.focus');
    },
  };
};
