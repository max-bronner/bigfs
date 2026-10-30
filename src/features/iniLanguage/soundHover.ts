import * as vscode from 'vscode';
import { findAssetReferences } from '../../formats/ini/sageIniAssets';
import { resolveAudio } from '../../game/audio/sageAudioResolve';
import type { AudioLookup } from '../../game/audio/sageAudioResolve';
import type { SageDocument, SageToken } from '../../formats/ini/sageIniParser';

/** INI text in markdown: it must not open a link or a code span of its own */
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_{}[\]()<>#+!|-]/g, '\\$&');
/** Links a hover lists before pointing to the lens instead */
const HOVER_LINKS = 12;

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

const commandLink = (title: string, command: string, args: unknown[]) =>
  `[${escapeMarkdown(title)}](command:${command}?${encodeURIComponent(JSON.stringify(args)).replace(/[()]/g, (bracket) => (bracket === '(' ? '%28' : '%29'))})`;

/**
 * Play links for a hovered value: a sound variant plays its file, a name of
 * an audio event lists its variants
 */
export const describeSound = async (
  lookup: AudioLookup,
  parsed: SageDocument,
  line: number,
  token: SageToken,
  documentUri: vscode.Uri,
): Promise<vscode.MarkdownString | undefined> => {
  const reference = findAssetReferences(parsed).find(
    (each) =>
      each.kind === 'sound' &&
      each.line === line &&
      each.start <= token.start &&
      token.start < each.end,
  );
  const text = new vscode.MarkdownString();

  text.isTrusted = { enabledCommands: ['bigfs.playSound'] };

  if (reference) {
    text.appendMarkdown(
      `${code(reference.name)} — sound\n\n${commandLink('▶ Play', 'bigfs.playSound', [reference.name, documentUri.toString()])}`,
    );
    return text;
  }

  const variants = await resolveAudio(token.text, lookup);

  if (!variants.length) {
    return undefined;
  }

  const shown = variants.slice(0, HOVER_LINKS);

  text.appendMarkdown(
    `${code(token.text)} — ${variants.length} sound${variants.length === 1 ? '' : 's'}\n\n` +
      shown
        .map(
          (variant) =>
            `${variants.length > 1 ? `${escapeMarkdown(variant.label)}: ` : ''}${commandLink(`▶ ${variant.file}`, 'bigfs.playSound', [variant.file, documentUri.toString()])}`,
        )
        .join(variants.length > 1 ? '\n\n' : ' · ') +
      (variants.length > shown.length
        ? `\n\n…and ${variants.length - shown.length} more; use the Play lens`
        : ''),
  );
  return text;
};
