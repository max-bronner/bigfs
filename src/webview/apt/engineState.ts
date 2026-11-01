import type { PlaySoundRequest } from '../../core/soundClip';
import { Engine } from './avm/engine';
import { pageSoundPlayer } from '../shared/pageSoundPlayer';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { EngineValues, FromPage, PageMovie } from './protocol';

const vscode = getVsCodeApi<FromPage>();

/**
 * The one engine boundary of the page: what the shown movie asks of the
 * game, and what the user answers. Answers are kept per movie by the editor,
 * in the workspace state, so they survive closing it.
 */

/** Sends a sound request to the editor, which answers with the bytes to play */
export const postSoundRequest = (request: PlaySoundRequest): void =>
  vscode.postMessage(request);

const listeners = { change: () => {}, log: (_line: string) => {} };

/** Engine the page runs the shown movie on; sounds it raises play in the page when Play movie sounds is ticked */
export const engine = new Engine(
  () => listeners.change(),
  (line) => listeners.log(line),
  (event) => pageSoundPlayer.request(event, postSoundRequest),
);

/** Sets the callback run when the engine's values or questions change */
export const onEngineChange = (change: () => void): void => {
  listeners.change = change;
};

/** Sets the callback that receives each line the engine logs */
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
