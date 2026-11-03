import type { Archive } from './archive';
import type { TreeNode } from './virtualTree';

/** A file or directory in the virtual tree, in the archive that holds it */
export type VirtualNode = TreeNode<Archive>;
