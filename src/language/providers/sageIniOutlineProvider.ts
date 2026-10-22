import { DocumentSymbol, Range, SymbolKind } from 'vscode';
import type { DocumentSymbolProvider, TextDocument } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import type { SageBlock } from '../model/sageIniParser';

/**
 * Builds the outline: root blocks at the top, their modules and nested blocks
 * beneath them. `Object` files run to thousands of lines and are unnavigable
 * without this.
 */

/** The symbol kind that reads best in the outline for each shape of block */
const symbolKindOf = (block: SageBlock, isRoot: boolean): SymbolKind => {
  if (block.moduleType) {
    return SymbolKind.Method;
  }

  return isRoot ? SymbolKind.Class : SymbolKind.Struct;
};

/**
 * Names a block for the outline. A module reads best by its type with the tag
 * beside it, since the tag is what other modules reference; anything else
 * reads best by its name, falling back to the keyword for blocks that carry
 * none, such as `GameData`.
 */
const describeBlock = (block: SageBlock): { name: string; detail: string } => {
  if (block.moduleType) {
    return { name: block.moduleType, detail: block.moduleTag ?? block.keyword };
  }

  return block.name
    ? { name: block.name, detail: block.keyword }
    : { name: block.keyword, detail: '' };
};

const toSymbol = (
  document: TextDocument,
  block: SageBlock,
  isRoot: boolean,
): DocumentSymbol => {
  const { name, detail } = describeBlock(block);
  const range = new Range(
    block.startLine,
    0,
    block.endLine,
    document.lineAt(block.endLine).text.length,
  );

  const symbol = new DocumentSymbol(
    name,
    detail,
    symbolKindOf(block, isRoot),
    range,
    document.lineAt(block.startLine).range,
  );

  symbol.children = block.children.map((child) =>
    toSymbol(document, child, false),
  );

  return symbol;
};

export const createSageIniOutlineProvider = (
  documents: SageIniDocuments,
): DocumentSymbolProvider => ({
  async provideDocumentSymbols(document) {
    const { blocks } = await documents.parse(document);

    return blocks.map((block) => toSymbol(document, block, true));
  },
});
