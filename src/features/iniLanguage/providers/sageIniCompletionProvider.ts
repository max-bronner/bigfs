import { CompletionItem, CompletionItemKind, Range } from 'vscode';
import type { CompletionItemProvider, Position, TextDocument } from 'vscode';
import type { SageIniDocuments } from '../../../services/ini/sageIniDocuments';
import type { SageIniSchema } from '../../../formats/ini/sageIniSchema';
import { stripComment, tokenize } from '../../../formats/ini/sageIniParser';
import type { SageBlock, SageDocument } from '../../../formats/ini/sageIniParser';
import type { SageIniIndex } from '../../../services/ini/sageIniIndex';

/**
 * Suggests what is legal where the cursor is.
 *
 * What that means depends entirely on the context, which is the whole
 * difficulty of this dialect. At the start of a line inside a `Behavior` the
 * legal fields are the ones that module type takes, not the 881 that some
 * `Behavior` somewhere takes. On the value of a `TriggeredBy` the legal words
 * are the names of `Upgrade` blocks, which live in other archives. On a
 * `KindOf` they are a fixed vocabulary.
 *
 * Nothing offered here is invented: every suggestion is a keyword, type, value
 * or name observed in the shipped data, so a completion is always something
 * the engine has been seen to accept.
 */

/** Finds the word the cursor is in, so a completion replaces the typed prefix instead of duplicating it */
const wordRangeAt = (
  document: TextDocument,
  position: Position,
): Range | undefined => {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_]+/);

  return range;
};

/**
 * Finds the context the cursor's line sits in. The parse records a context per
 * statement, but a line being typed is usually not a statement yet, so the
 * context is taken from the nearest block that is still open above it.
 */
const contextAt = (
  { blocks, fileContext }: SageDocument,
  line: number,
): { context: string; slot?: string } => {
  let context = fileContext;
  let slot: string | undefined;

  const descend = (candidates: readonly SageBlock[]) => {
    for (const block of candidates) {
      if (line <= block.startLine || line > block.endLine) {
        continue;
      }

      context = block.context;
      slot = block.moduleType ? block.keyword : undefined;
      descend(block.children);

      return;
    }
  };

  descend(blocks);

  return { context, slot };
};

const toItem = (
  label: string,
  kind: CompletionItemKind,
  detail: string,
  range?: Range,
): CompletionItem => {
  const item = new CompletionItem(label, kind);

  item.detail = detail;

  if (range) {
    item.range = range;
  }

  return item;
};

/** Creates the completion provider over the shared parse and the cross-archive index */
export const createSageIniCompletionProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): CompletionItemProvider => ({
  async provideCompletionItems(document, position) {
    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);

    const line = document.lineAt(position.line).text;
    const before = stripComment(line).slice(0, position.character);
    const tokens = tokenize(before);
    const range = wordRangeAt(document, position);

    // Still on the first token, so the cursor is on the keyword itself
    const onKeyword =
      tokens.length === 0 ||
      (tokens.length === 1 && position.character <= tokens[0].end);

    const { context } = contextAt(parsed, position.line);

    if (onKeyword) {
      const keywords = schema.getContextKeywords(context);

      return keywords.map(({ name, kind }) =>
        toItem(
          name,
          kind === 'block'
            ? CompletionItemKind.Class
            : CompletionItemKind.Property,
          kind === 'block'
            ? `block in ${schema.describeContext(context)}`
            : describeField(schema, name, context),
          range,
        ),
      );
    }

    const keyword = tokens[0].text;

    // Second token of a module slot header names the module type, which is
    // what decides every field below it
    if (schema.isModuleSlot(keyword) && tokens.length <= 2) {
      return schema
        .getSlotTypes(keyword)
        .map((type) =>
          toItem(type, CompletionItemKind.Class, `${keyword} module`, range),
        );
    }

    // A reference field's values are names defined elsewhere
    const namespaces = schema.getReferenceNamespaces(keyword, context);

    if (namespaces.length) {
      await index.whenReady();

      return namespaces.flatMap((namespace) =>
        index
          .getNames(namespace)
          .map((name) =>
            toItem(name, CompletionItemKind.Reference, namespace, range),
          ),
      );
    }

    // A macro can stand in for any value, so they are offered alongside the
    // field's own vocabulary rather than instead of it
    await index.whenReady();

    return [
      ...schema
        .getEnumValues(keyword)
        .map((value) =>
          toItem(value, CompletionItemKind.EnumMember, keyword, range),
        ),
      ...index
        .getMacroNames()
        .map(({ name, value }) =>
          toItem(name, CompletionItemKind.Constant, `= ${value}`, range),
        ),
    ];
  },
});

/** Describes a field for the completion detail: its engine type when it has one */
const describeField = (
  schema: SageIniSchema,
  name: string,
  context: string,
): string => {
  const engineField = schema.getEngineField(name);

  if (!engineField) {
    return `field in ${schema.describeContext(context)}`;
  }

  return engineField.used
    ? engineField.type
    : `${engineField.type} — not read by the engine`;
};
