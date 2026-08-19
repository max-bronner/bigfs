import { Uri } from 'vscode';
import { SCHEME } from '../constants';

/**
 * Builds the URI of a node from its path
 */
export const getNodeUri = (nodePath: string): Uri =>
  Uri.from({ scheme: SCHEME, path: nodePath });
