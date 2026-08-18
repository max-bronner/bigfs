import { Uri } from 'vscode';
import { SCHEME } from '../constants';
import { splitPath } from './paths';

export interface ParsedNodeUri {
  archiveName: string;
  entrySegments: string[];
}

/**
 * Builds the URI of a node from its path
 */
export const getNodeUri = (nodePath: string): Uri =>
  Uri.from({ scheme: SCHEME, path: nodePath });

/**
 * Parses a node URI into the archive name and the segments of the entry path
 */
export const parseNodeUri = (uri: Uri): ParsedNodeUri => {
  const [archiveName, ...entrySegments] = splitPath(uri.path);

  return { archiveName, entrySegments };
};
