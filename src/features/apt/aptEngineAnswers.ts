import type { Memento } from 'vscode';
import type { EngineValues } from '../../webview/apt/protocol';
import { movieKey } from './aptLibrary';

/** The workspace state key of the Engine panel's answers, by movie name */
export const ENGINE_ANSWERS = 'bigfs.apt.engineAnswers';

/** Reads the Engine panel's answers kept for every movie */
export const readEngineAnswers = (
  state: Memento,
): Record<string, EngineValues> =>
  state.get<Record<string, EngineValues>>(ENGINE_ANSWERS, {});

/** Keeps the answers given for a movie; none removes them */
export const keepEngineAnswers = async (
  state: Memento,
  name: string,
  values: EngineValues | undefined,
): Promise<void> => {
  const all = { ...readEngineAnswers(state) };

  if (values) {
    all[movieKey(name)] = values;
  } else {
    delete all[movieKey(name)];
  }
  await state.update(ENGINE_ANSWERS, all);
};
