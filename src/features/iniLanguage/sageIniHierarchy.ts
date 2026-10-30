import * as vscode from 'vscode';
import { stripComment, tokenize } from '../../formats/ini/sageIniParser';
import type { SageBlock, SageDocument } from '../../formats/ini/sageIniParser';
import { resolveSageSymbol } from '../../formats/ini/sageIniSymbol';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageDefinition, SageIniIndex } from '../../services/ini/sageIniIndex';
import { createParseCache, readWorkspaceText } from '../../services/ini/workspaceText';

/**
 * Definitions as a graph, in the editor's own views. The call hierarchy
 * answers "what does this use" (every definition its fields name, down
 * through weapons, FX lists and particle systems) and "what uses this"
 * (every definition naming it). The type hierarchy follows ChildObject and
 * ObjectReskin inheritance up to the parent and down to every child.
 */

const TEMPLATE_KEYWORDS = ['Object', 'ChildObject', 'ObjectReskin'];
const INHERITING = ['ChildObject', 'ObjectReskin'];

const findTopBlockAt = (parsed: SageDocument, line: number) =>
  parsed.blocks.find(
    (block) => block.startLine <= line && line <= block.endLine,
  );

/** Builds the item for a file-scope block, named by its header's first value */
const toBlockItem = <
  T extends vscode.CallHierarchyItem | vscode.TypeHierarchyItem,
>(
  make: new (
    kind: vscode.SymbolKind,
    name: string,
    detail: string,
    uri: vscode.Uri,
    range: vscode.Range,
    selectionRange: vscode.Range,
  ) => T,
  parsed: SageDocument,
  block: SageBlock,
  uri: vscode.Uri,
): T | undefined => {
  const header = parsed.statements.find(
    (statement) => statement.line === block.startLine,
  );
  const name = header?.values[0];

  if (!name) {
    return undefined;
  }
  return new make(
    vscode.SymbolKind.Object,
    name.text,
    block.keyword,
    uri,
    new vscode.Range(block.startLine, 0, block.endLine, 0),
    new vscode.Range(block.startLine, name.start, block.startLine, name.end),
  );
};

const toDefinitionItem = <
  T extends vscode.CallHierarchyItem | vscode.TypeHierarchyItem,
>(
  make: new (
    kind: vscode.SymbolKind,
    name: string,
    detail: string,
    uri: vscode.Uri,
    range: vscode.Range,
    selectionRange: vscode.Range,
  ) => T,
  definition: SageDefinition,
): T =>
  new make(
    vscode.SymbolKind.Object,
    definition.name,
    definition.keyword,
    definition.uri,
    new vscode.Range(definition.line, 0, definition.endLine, 0),
    new vscode.Range(
      definition.line,
      definition.start,
      definition.line,
      definition.end,
    ),
  );

const toItemKey = (item: { uri: vscode.Uri; range: vscode.Range }) =>
  `${item.uri.toString()}#${item.range.start.line}`;

/** Builds the item for the definition under the cursor: the one named there, or the one around it */
const prepare = async <
  T extends vscode.CallHierarchyItem | vscode.TypeHierarchyItem,
>(
  make: new (
    kind: vscode.SymbolKind,
    name: string,
    detail: string,
    uri: vscode.Uri,
    range: vscode.Range,
    selectionRange: vscode.Range,
  ) => T,
  documents: SageIniDocuments,
  index: SageIniIndex,
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<T | undefined> => {
  const [parsed, schema] = await Promise.all([
    documents.parse(document),
    documents.getSchema(),
  ]);
  const symbol = resolveSageSymbol(
    parsed,
    schema,
    position.line,
    position.character,
  );

  if (symbol && !symbol.isDeclaration) {
    await index.whenReady();
    for (const namespace of symbol.namespaces) {
      const [definition] = index.findDefinitions(namespace, symbol.name);

      if (definition) {
        return toDefinitionItem(make, definition);
      }
    }
  }

  const block = findTopBlockAt(parsed, position.line);

  return block && toBlockItem(make, parsed, block, document.uri);
};

/** Creates the call hierarchy provider: what a definition's fields name, and what names it */
export const createCallHierarchyProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.CallHierarchyProvider => ({
  prepareCallHierarchy: (document, position) =>
    prepare(vscode.CallHierarchyItem, documents, index, document, position),

  async provideCallHierarchyOutgoingCalls(item) {
    const parses = createParseCache(documents);
    const read = (uri: vscode.Uri) => parses.get(uri);
    const parsed = await read(item.uri);
    const schema = await documents.getSchema();
    const block = parsed && findTopBlockAt(parsed, item.range.start.line);

    if (!parsed || !block) {
      return [];
    }
    await index.whenReady();

    const calls = new Map<string, vscode.CallHierarchyOutgoingCall>();

    for (const statement of parsed.statements) {
      if (
        statement.kind !== 'field' ||
        statement.line <= block.startLine ||
        statement.line >= block.endLine
      ) {
        continue;
      }
      for (const token of statement.values) {
        const symbol = resolveSageSymbol(
          parsed,
          schema,
          statement.line,
          token.start,
        );
        const definition =
          symbol &&
          !symbol.isDeclaration &&
          symbol.namespaces
            .map(
              (namespace) => index.findDefinitions(namespace, symbol.name)[0],
            )
            .find(Boolean);

        if (!definition) {
          continue;
        }

        const target = toDefinitionItem(vscode.CallHierarchyItem, definition);
        const range = new vscode.Range(
          statement.line,
          token.start,
          statement.line,
          token.end,
        );
        const call = calls.get(toItemKey(target));

        if (call) {
          call.fromRanges.push(range);
        } else {
          calls.set(
            toItemKey(target),
            new vscode.CallHierarchyOutgoingCall(target, [range]),
          );
        }
      }
    }
    return [...calls.values()];
  },

  async provideCallHierarchyIncomingCalls(item) {
    await index.whenReady();

    const parses = createParseCache(documents);
    const read = (uri: vscode.Uri) => parses.get(uri);
    const calls = new Map<string, vscode.CallHierarchyIncomingCall>();

    for (const place of index.findReferences(item.detail ?? '', item.name)) {
      const parsed = await read(place.uri);
      const block = parsed && findTopBlockAt(parsed, place.line);
      const from =
        parsed &&
        block &&
        toBlockItem(vscode.CallHierarchyItem, parsed, block, place.uri);

      if (!from) {
        continue;
      }

      const range = new vscode.Range(
        place.line,
        place.start,
        place.line,
        place.end,
      );
      const call = calls.get(toItemKey(from));

      if (call) {
        call.fromRanges.push(range);
      } else {
        calls.set(
          toItemKey(from),
          new vscode.CallHierarchyIncomingCall(from, [range]),
        );
      }
    }
    return [...calls.values()];
  },
});

/** Reads the parent a ChildObject or ObjectReskin header names */
const readParentName = (headerLine: string): string | undefined => {
  const [keyword, , parent] = tokenize(stripComment(headerLine));

  return keyword &&
    INHERITING.some((each) => each.toLowerCase() === keyword.text.toLowerCase())
    ? parent?.text
    : undefined;
};

/** Creates the type hierarchy provider following ChildObject and ObjectReskin inheritance */
export const createTypeHierarchyProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.TypeHierarchyProvider => {
  const createLineReader = () => {
    const texts = new Map<string, Promise<string[]>>();

    return (uri: vscode.Uri, line: number): Promise<string> => {
      const key = uri.toString();
      let text = texts.get(key);

      if (!text) {
        text = readWorkspaceText(uri)
          .then((content) => content.split(/\r?\n/))
          .catch(() => []);
        texts.set(key, text);
      }
      return text.then((lines) => lines[line] ?? '');
    };
  };

  return {
    async prepareTypeHierarchy(document, position) {
      const item = await prepare(
        vscode.TypeHierarchyItem,
        documents,
        index,
        document,
        position,
      );

      return item &&
        TEMPLATE_KEYWORDS.some(
          (keyword) => keyword.toLowerCase() === item.detail?.toLowerCase(),
        )
        ? item
        : undefined;
    },

    async provideTypeHierarchySupertypes(item) {
      const header = await createLineReader()(item.uri, item.range.start.line);
      const parent = readParentName(header);

      if (!parent) {
        return [];
      }
      await index.whenReady();
      for (const keyword of TEMPLATE_KEYWORDS) {
        const [definition] = index.findDefinitions(keyword, parent);

        if (definition) {
          return [toDefinitionItem(vscode.TypeHierarchyItem, definition)];
        }
      }
      return [];
    },

    async provideTypeHierarchySubtypes(item) {
      await index.whenReady();

      const read = createLineReader();
      const children: vscode.TypeHierarchyItem[] = [];

      // The three template keywords are one namespace; only the inheriting
      // ones carry a parent
      for (const name of index.getNames('Object')) {
        for (const definition of index.findDefinitions('Object', name)) {
          if (
            !INHERITING.some(
              (each) => each.toLowerCase() === definition.keyword.toLowerCase(),
            )
          ) {
            continue;
          }

          const parent = readParentName(await read(definition.uri, definition.line));

          if (parent?.toLowerCase() === item.name.toLowerCase()) {
            children.push(
              toDefinitionItem(vscode.TypeHierarchyItem, definition),
            );
          }
        }
      }
      return children;
    },
  };
};
