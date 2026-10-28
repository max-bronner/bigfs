/** The handle VS Code gives a webview page, typed by the messages the page posts */
export interface VsCodeApi<Message> {
  postMessage(message: Message): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: () => VsCodeApi<unknown>;

let handle: VsCodeApi<unknown> | undefined;

/**
 * Returns the page's VS Code handle, typed by the messages the page posts.
 * VS Code allows `acquireVsCodeApi` once per page, so the first call acquires
 * it and every later call returns the same handle.
 */
export const getVsCodeApi = <Message>(): VsCodeApi<Message> => {
  handle ??= acquireVsCodeApi();
  return handle as VsCodeApi<Message>;
};
