import { Engine } from './avm/engine';
import type { EngineValues } from './avm/engine';
import { vscode } from './details';
import type { PageMovie } from './protocol';

/**
 * The one engine boundary of the page: what the shown movie asks of the
 * game, and what the user answers, kept per movie in the webview's state
 * so the answers survive closing the editor.
 */

const listeners = { change: () => {}, log: (_line: string) => {} };

export const engine = new Engine(
  () => listeners.change(),
  (line) => listeners.log(line),
);

export const onEngineChange = (change: () => void): void => {
  listeners.change = change;
};

export const onEngineLog = (log: (line: string) => void): void => {
  listeners.log = log;
};

let current = '';

const saved = (): Record<string, EngineValues> => {
  const state = vscode.getState() as
    { engine?: Record<string, EngineValues> } | undefined;

  return state?.engine ?? {};
};

/** Starts watching a run of a movie, with its answers as last given */
export const watchMovie = (movie: PageMovie): void => {
  if (movie.name !== current) {
    current = movie.name;
    engine.load(saved()[current]);
  }
  engine.reset(movie);
};

/** Keeps the answers given for the movie shown */
export const saveAnswers = (): void => {
  const state = (vscode.getState() ?? {}) as Record<string, unknown>;

  vscode.setState({
    ...state,
    engine: { ...saved(), [current]: engine.save() },
  });
};
