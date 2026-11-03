/** Error thrown for a save that cannot be made, at the line, from 0, of the text that asks for it */
export class TextSaveError extends Error {
  public constructor(
    message: string,
    public readonly line = 0,
  ) {
    super(message);
  }
}
