import { getVsCodeApi } from '../shared/vscodeApi';

/**
 * What the texture page keeps when VS Code rebuilds it, as it does when the
 * editor moves to another window
 */
export interface PageState {
  /** Zoom factor, 0 for fit */
  zoom?: number;
  /** Width in pixels of the references panel */
  panelWidth?: number;
}

/** Reads what the page saved before it was rebuilt */
export const readPageState = (): PageState =>
  (getVsCodeApi().getState() as PageState | undefined) ?? {};

/** Saves a change to the page's state, keeping the rest */
export const savePageState = (change: PageState): void =>
  getVsCodeApi().setState({ ...readPageState(), ...change });
