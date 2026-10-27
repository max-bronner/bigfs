/** The part of a source that decides whether it can be written to */
export interface WritableSource {
  readonly label: string;
  /** Outside the workspace, so a game install the user did not open */
  readonly external: boolean;
}

/** Thrown for a write into a source that is read-only */
export class ReadOnlySourceError extends Error {
  constructor(label: string) {
    super(
      `${label} is read-only: it is a game install outside the workspace, ` +
        `so its archives are never changed. Copy what you need into a folder of the workspace instead.`,
    );
    this.name = 'ReadOnlySourceError';
  }
}

/** Whether nothing may be written into a source, which holds for a game install the user did not open */
export const isReadOnlySource = (source: WritableSource): boolean =>
  source.external;

/** Throws when a source is read-only, so no write reaches its archives */
export const assertWritableSource = (source: WritableSource): void => {
  if (isReadOnlySource(source)) {
    throw new ReadOnlySourceError(source.label);
  }
};
