import { Hover, MarkdownString, Range } from 'vscode';
import type { HoverProvider, Position, TextDocument, Uri } from 'vscode';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniSchema } from '../../formats/ini/sageIniSchema';
import type {
  SageDocument,
  SageStatement,
  SageToken,
} from '../../formats/ini/sageIniParser';
import {
  evaluateCall,
  evaluateMacroBody,
  formatValue,
} from '../../formats/ini/sageIniPreprocessor';
import type { SageDefinition, SageIniIndex } from '../../services/ini/sageIniIndex';

/**
 * Explains what is under the cursor: whether the engine defines it, what type
 * it reads the value as, and what a reference points at.
 *
 * The distinction worth surfacing is engine defined against merely observed. A
 * field that appears in the shipped data is not necessarily one the engine
 * still reads, and a field absent from the data may be perfectly valid - the
 * corpus shows only what was used. Saying which is which is the difference
 * between a guess and an answer.
 */

/** How the engine's own type names read to someone editing the file */
const TYPE_NOTES: Record<string, string> = {
  AssetPath: 'a file path, loaded from another archive',
  BitFlags: 'a space separated set of flags',
  Bool: '`Yes` or `No`',
  Color: 'keyed channels, `R:255 G:255 B:255 A:255`',
  Coord3D: 'keyed components, `X:0.0 Y:0.0 Z:0.0`',
  Enum: 'one of a fixed set the engine closes',
  Int: 'a whole number',
  NumPair: 'a pair of numbers',
  Percent: 'a percentage, written with a trailing `%`',
  Real: 'a decimal number',
  Ref: 'a name defined elsewhere',
  RefList: 'names defined elsewhere',
};

/** Finds the statement whose keyword or values cover a position */
const statementAt = (
  { statements }: SageDocument,
  position: Position,
): SageStatement | undefined =>
  statements.find((statement) => statement.line === position.line);

/** The token of a statement the position sits on, if any */
const tokenAt = (statement: SageStatement, character: number) =>
  [statement.keyword, ...statement.values].find(
    (token) => character >= token.start && character <= token.end,
  );

const describeKeyword = (
  statement: SageStatement,
  schema: SageIniSchema,
): MarkdownString => {
  const text = new MarkdownString();
  const name = statement.keyword.text;

  if (statement.block) {
    const engine = schema.isEngineBlock(name);

    text.appendMarkdown(`**${name}** — block`);
    text.appendMarkdown(
      engine
        ? '\n\nDispatched by the engine at file scope.'
        : '\n\nObserved in the shipped data. The engine does not dispatch on this name at file scope, so it is nested.',
    );

    if (statement.block.moduleType) {
      text.appendMarkdown(
        `\n\nModule slot. The type \`${statement.block.moduleType}\` decides which fields are legal below it` +
          (statement.block.moduleTag
            ? `, and the tag \`${statement.block.moduleTag}\` must be unique within its Object.`
            : '.'),
      );
    }

    return text;
  }

  const engineField = schema.getEngineField(name);

  text.appendMarkdown(`**${name}** — field`);

  if (!engineField) {
    text.appendMarkdown(
      '\n\nNot in the engine dump. That is not an error: the dump covers the tables it could recover, and the engine accepts more than the shipped data uses.',
    );

    return text;
  }

  const note = TYPE_NOTES[engineField.type];

  text.appendMarkdown(
    `\n\nEngine defined, read as \`${engineField.type}\`${note ? ` — ${note}` : ''}.`,
  );

  if (!engineField.used) {
    text.appendMarkdown(
      '\n\n⚠️ No engine table still reads this field. It parses, but setting it has no effect.',
    );
  }

  return text;
};

const describeValue = (
  statement: SageStatement,
  schema: SageIniSchema,
  value: string,
): MarkdownString | undefined => {
  const namespaces = schema.getReferenceNamespaces(
    statement.keyword.text,
    statement.context,
  );

  if (!namespaces.length) {
    return undefined;
  }

  const text = new MarkdownString();

  text.appendMarkdown(`\`${value}\` — reference`);
  text.appendMarkdown(
    namespaces.length === 1
      ? `\n\nResolves to a **${namespaces[0]}** definition.`
      : `\n\nResolves to a **${namespaces.join('** or **')}** definition, whichever holds the name.`,
  );

  return text;
};

/** Creates the provider, sharing the parse the other providers already did */
export const createSageIniHoverProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
  previewImage?: (definition: SageDefinition) => Promise<string | undefined>,
  previewCommandSet?: (definition: SageDefinition) => Promise<string>,
  describeSound?: (
    parsed: SageDocument,
    line: number,
    token: SageToken,
    uri: Uri,
  ) => Promise<MarkdownString | undefined>,
): HoverProvider => ({
  async provideHover(document: TextDocument, position: Position) {
    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);
    const lookupMacro = (name: string) => index.findMacro(name)?.value;

    // An arithmetic call answers as a whole, wherever in it the cursor is
    const call = parsed.calls.find(
      ({ line, start, end }) =>
        line === position.line &&
        position.character >= start &&
        position.character <= end,
    );

    if (call) {
      await index.whenReady();

      const result = evaluateCall(call, lookupMacro);
      const operands = call.operands
        .map((operand) => {
          const body = lookupMacro(operand.text);

          return body === undefined
            ? ''
            : `\n- \`${operand.text}\` = \`${body}\``;
        })
        .join('');
      const text = new MarkdownString();

      text.appendMarkdown(
        'value' in result
          ? `\`#${call.operation}\` = **${formatValue(result.value)}**${operands}`
          : `\`#${call.operation}\` cannot be evaluated: ${result.error}`,
      );

      return new Hover(
        text,
        new Range(call.line, call.start, call.line, call.end),
      );
    }

    const statement = statementAt(parsed, position);

    if (!statement) {
      return undefined;
    }

    const token = tokenAt(statement, position.character);

    if (!token) {
      return undefined;
    }

    const range = new Range(
      statement.line,
      token.start,
      statement.line,
      token.end,
    );

    if (token === statement.keyword) {
      return new Hover(describeKeyword(statement, schema), range);
    }

    // `#(NAME)` splices a macro into the middle of a token
    if (token.text.includes('#(')) {
      await index.whenReady();

      const expanded = token.text.replace(
        /#\(([^)]*)\)/g,
        (whole, name: string) => lookupMacro(name)?.trim() ?? whole,
      );
      const text = new MarkdownString();

      text.appendMarkdown(`\`${token.text}\` expands to \`${expanded}\``);

      return new Hover(text, range);
    }

    // A macro stands in for the value before anything else reads it, so it
    // answers first and shows what the value actually becomes
    const macro = index.findMacro(token.text);

    if (macro) {
      const text = new MarkdownString();

      text.appendMarkdown(`\`${macro.name}\` — macro`);
      text.appendCodeblock(`#define ${macro.name} ${macro.value}`, 'sage-ini');

      const evaluated = evaluateMacroBody(macro.value, lookupMacro);

      if (evaluated) {
        text.appendMarkdown(
          'value' in evaluated
            ? `= **${formatValue(evaluated.value)}**`
            : `Cannot be evaluated: ${evaluated.error}`,
        );
      }

      return new Hover(text, range);
    }

    // A label in the string tables is shown as the text the game displays
    const string = index.findString(token.text);

    if (string) {
      const text = new MarkdownString();

      text.appendMarkdown(`\`${string.label}\` — game text\n\n`);
      text.appendText(string.text);

      return new Hover(text, range);
    }

    const [commandSet] = previewCommandSet
      ? index.findDefinitions('CommandSet', token.text)
      : [];

    if (commandSet && previewCommandSet) {
      const text = new MarkdownString(await previewCommandSet(commandSet));

      text.supportHtml = true;
      return new Hover(text, range);
    }

    const contents = describeValue(statement, schema, token.text);
    const sound = await describeSound?.(
      parsed,
      statement.line,
      token,
      document.uri,
    );

    if (sound) {
      return new Hover(contents ? [contents, sound] : sound, range);
    }
    const [image] = previewImage
      ? index.findDefinitions('MappedImage', token.text)
      : [];
    const picture =
      image && previewImage ? await previewImage(image) : undefined;

    if (picture) {
      const text =
        contents ?? new MarkdownString(`\`${token.text}\` — MappedImage`);

      text.appendMarkdown(`\n\n${picture}`);

      return new Hover(text, range);
    }

    return contents ? new Hover(contents, range) : undefined;
  },
});
