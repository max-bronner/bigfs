/** Formats a count with its unit, adding an 's' for the plural, so the unit has to be a word that takes one */
export const formatCount = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? '' : 's'}`;
