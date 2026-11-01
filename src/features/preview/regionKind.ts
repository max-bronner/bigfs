import type * as vscode from 'vscode';
import type { TextureRegion } from '../../webview/preview/protocol';

/**
 * One kind of thing that uses part of a texture, as the preview sees it: how
 * its regions are named, read from the document that defines them, and
 * written back to it. Region ids are opaque to everything but their kind.
 */
export interface RegionKind {
  /** Whether the id names a region of this kind */
  owns(id: string): boolean;
  /** Reads the region from its document as it is now, or nothing when it is gone or unreadable */
  read(
    id: string,
    decoded: readonly [number, number],
  ): Promise<TextureRegion | undefined>;
  /** Writes a box, in pixels of the decoded texture, into the region's document; whether it changed */
  write(
    id: string,
    decoded: readonly [number, number],
    rect: readonly [number, number, number, number],
  ): Promise<boolean>;
  /** The document that defines the region, so its edits redraw the box */
  documentOf(id: string): vscode.Uri | undefined;
}
