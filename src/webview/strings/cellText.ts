/** Counts the rows a cell's text editor opens with: the text's own lines, at least two */
export const countEditorRows = (value: string): number =>
  Math.max(2, value.split('\n').length);

/**
 * Whether the edited text differs from the original. A text field reports
 * every line break as LF, which is not an edit of CRLF text.
 */
export const isEdited = (original: string, edited: string): boolean =>
  edited !== original.replace(/\r\n?/g, '\n');
