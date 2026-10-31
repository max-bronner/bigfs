import type { Instance } from './instance';

/** Describes an instance for the log: its name, character id and path */
export const describeInstance = (instance: Instance): string =>
  (instance.name ? `"${instance.name}" ` : "") +
  `#${instance.id}${instance.path ? " @" + instance.path : ""}`;
