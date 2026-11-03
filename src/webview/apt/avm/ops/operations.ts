import type { Operation } from '../vmState';
import { ARITHMETIC_OPS } from './arithmeticOps';
import { CONTROL_OPS } from './controlOps';
import { FUNCTION_OPS } from './functionOps';
import { MEMBER_OPS } from './memberOps';
import { STACK_OPS } from './stackOps';
import { TIMELINE_OPS } from './timelineOps';
import { VARIABLE_OPS } from './variableOps';

/**
 * Dispatch table of the machine, by opcode name. A map, because the names come
 * from the movie; an opcode that is not in it halts the script.
 */
export const OPERATIONS: ReadonlyMap<string, Operation> = new Map(
  Object.entries({
    ...STACK_OPS,
    ...VARIABLE_OPS,
    ...MEMBER_OPS,
    ...ARITHMETIC_OPS,
    ...CONTROL_OPS,
    ...TIMELINE_OPS,
    ...FUNCTION_OPS,
  }),
);
