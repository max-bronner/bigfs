/** What the report's buttons ask for: a file by its path in the report */
export interface FromModDiffPage {
  action: 'diff' | 'open';
  path: string;
}
