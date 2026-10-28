import { FoldingRange, FoldingRangeKind } from 'vscode';
import type { FoldingRangeProvider } from 'vscode';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageBlock } from '../../formats/ini/sageIniParser';

/**
 * Folds each block from its header to its closing `End`, and each embedded
 * Lua region between `BeginScript` and `EndScript`.
 *
 * This is the cheapest of the providers - it only needs the block tree, not
 * the schema - and on its own is already a large quality-of-life win in the
 * 5,000-line files this dialect produces.
 */
export const createSageIniFoldingProvider = (
  documents: SageIniDocuments,
): FoldingRangeProvider => ({
  async provideFoldingRanges(document) {
    const { blocks, scripts } = await documents.parse(document);
    const ranges: FoldingRange[] = [];

    const collect = (block: SageBlock): void => {
      if (block.endLine > block.startLine) {
        ranges.push(new FoldingRange(block.startLine, block.endLine));
      }

      block.children.forEach(collect);
    };

    blocks.forEach(collect);

    scripts.forEach(({ startLine, endLine }) => {
      if (endLine > startLine) {
        ranges.push(
          new FoldingRange(startLine, endLine, FoldingRangeKind.Region),
        );
      }
    });

    return ranges;
  },
});
