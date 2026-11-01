import type { AudioVariant } from './sageAudioResolve';

/** The part of a variant label after any `Multisound` or side path */
const lastLabel = (label: string) => label.split(' › ').pop() ?? label;

/**
 * Picks the variant a single press plays: the first of the event's `Sounds`
 * lists, else the first listed. An attack is never chained to its body.
 */
export const chooseSoundVariant = (
  variants: readonly AudioVariant[],
): AudioVariant | undefined =>
  variants.find((variant) => /^sounds\w*$/i.test(lastLabel(variant.label))) ??
  variants[0];
