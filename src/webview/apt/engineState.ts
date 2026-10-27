import { Engine } from './avm/engine';
import type { EngineValues } from './avm/engine';
import { vscode } from './details';
import type { PageMovie } from './protocol';

/**
 * The one engine boundary of the page: what the shown movie asks of the
 * game, and what the user answers. Answers are kept per movie by the editor,
 * in the workspace state, so they survive closing it.
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
/** The answers kept in the workspace, which the editor sends with the movie */
let kept: EngineValues | undefined;

/** Starts watching a run of a movie, with its answers as last given */
export const watchMovie = (movie: PageMovie): void => {
  if (movie.name !== current) {
    current = movie.name;
    engine.load(kept);
  }
  engine.reset(movie);
};

/** Takes the answers the editor kept for the movie it is sending */
export const keepAnswers = (answers: EngineValues | undefined): void => {
  kept = answers;
};

/** Hands the answers given for the movie shown to the editor to keep */
export const saveAnswers = (): void => {
  kept = engine.save();
  vscode.postMessage({ kind: 'engineAnswers', values: kept });
};
