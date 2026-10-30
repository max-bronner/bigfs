/** Message the mod report's page sends when a row's button asks to diff or open that row's file */
export interface FromModDiffPage {
  action: 'diff' | 'open';
  path: string;
}
