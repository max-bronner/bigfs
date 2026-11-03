import { parse } from 'luaparse';
import type {
  AssignmentStatement,
  Chunk,
  Expression,
  FunctionDeclaration,
  IfStatement,
  LocalStatement,
  Statement,
} from 'luaparse';
import type { SubObjectRule } from '../../formats/w3d/w3dScene';

/**
 * Static reader of the Lua that shows and hides an object's sub-objects: the
 * `BeginScript` of an animation state and the `OnCreated` handler
 * `scriptevents.xml` binds to its `AILuaEventsList`. Nothing is run. A call
 * that always happens, with literal arguments, becomes a rule. A condition on
 * the previous animation state, the one thing a script asks that is known
 * ahead of time, is decided; a call under any other condition, past a possible
 * `return` or with a computed name is listed as `conditional`, never guessed at.
 */

/** A rule read from a script; the game applies a permanent one after every plain one */
export interface ScriptedRule extends SubObjectRule {
  isPermanent: boolean;
}

/** The sub-object calls found in a script */
export interface ScriptedSubObjects {
  rules: ScriptedRule[];
  /** Calls whose effect depends on the running game, as `NAME (source)` */
  conditional: string[];
}

/** An upgrade a handler always grants, which fires on the spot */
export interface GrantedUpgrade {
  name: string;
  /** How many of the handlers' `rules` come before the grant */
  at: number;
}

/** What the `OnCreated` handlers of an object do to it */
export interface CreatedSubObjects extends ScriptedSubObjects {
  grantedUpgrades: GrantedUpgrade[];
}

/** Where a call's arguments sit: `nameAt` the sub-object, `flagAt` a boolean that may reverse `hide` */
interface SubObjectCall {
  hide: boolean;
  isPermanent: boolean;
  nameAt: number;
  flagAt?: number;
}

/** Calls an animation state's script makes on its own drawable */
const DRAWABLE_CALLS = new Map<string, SubObjectCall>([
  ['CurDrawableHideSubObject', { hide: true, isPermanent: false, nameAt: 0 }],
  ['CurDrawableShowSubObject', { hide: false, isPermanent: false, nameAt: 0 }],
  ['CurDrawableHideSubObjectPermanently', { hide: true, isPermanent: true, nameAt: 0 }],
  ['CurDrawableShowSubObjectPermanently', { hide: false, isPermanent: true, nameAt: 0 }],
]);

/**
 * Calls an event handler makes on its object. `ObjectShowSubObjectPermanently`
 * is absent as the game never registers it; handlers pass `false` instead.
 * `ObjectHideSubObject` makes a plain write, as `CurDrawableHideSubObject` does.
 */
const OBJECT_CALLS = new Map<string, SubObjectCall>([
  ['ObjectHideSubObjectPermanently', { hide: true, isPermanent: true, nameAt: 1, flagAt: 2 }],
  ['ObjectHideSubObject', { hide: true, isPermanent: false, nameAt: 1, flagAt: 2 }],
]);

/** How deep a handler is followed into the functions it calls, as mint's `MAX_WALK_DEPTH` */
const MAX_CALL_DEPTH = 8;

/** Longest `Inherit` chain followed, as mint's `MAX_INHERIT`, so a cycle ends */
const MAX_INHERIT = 16;

/** A Lua value known ahead of time: `null` is `nil`, `undefined` not known */
type KnownValue = string | null | undefined;

/** One script being read: what to look for and where to collect it */
interface ScriptScan {
  calls: ReadonlyMap<string, SubObjectCall>;
  functions: ReadonlyMap<string, FunctionDeclaration>;
  source: string;
  found: CreatedSubObjects;
  /** What `CurDrawablePrevAnimationState` answers */
  previousState: KnownValue;
  /** The variables holding a known value */
  variables: Map<string, string | null>;
}

// luaparse leaves `value` empty in its default encoding mode, so the text is read from `raw`
const readText = (expression: Expression | undefined): string | undefined =>
  expression?.type === 'StringLiteral' ? expression.raw.slice(1, -1) : undefined;

const readKnownValue = (
  expression: Expression | undefined,
  scan: ScriptScan,
): KnownValue => {
  switch (expression?.type) {
    case 'StringLiteral':
      return readText(expression);
    case 'NilLiteral':
      return null;
    case 'Identifier':
      return scan.variables.get(expression.name);
    case 'CallExpression':
      return expression.base.type === 'Identifier' &&
        expression.base.name === 'CurDrawablePrevAnimationState'
        ? scan.previousState
        : undefined;
    default:
      return undefined;
  }
};

/** Decides a condition, or says nothing when any part of it needs the running game */
const resolveCondition = (
  expression: Expression,
  scan: ScriptScan,
): boolean | undefined => {
  switch (expression.type) {
    case 'BooleanLiteral':
      return expression.value;
    case 'BinaryExpression': {
      const left = readKnownValue(expression.left, scan);
      const right = readKnownValue(expression.right, scan);

      if (
        left === undefined ||
        right === undefined ||
        (expression.operator !== '==' && expression.operator !== '~=')
      ) {
        return undefined;
      }
      return (left === right) === (expression.operator === '==');
    }
    case 'LogicalExpression': {
      const left = resolveCondition(expression.left, scan);
      const right = resolveCondition(expression.right, scan);

      if (expression.operator === 'and') {
        return left === false || right === false ? false : left && right;
      }
      if (left === true || right === true) {
        return true;
      }
      return left === undefined || right === undefined ? undefined : false;
    }
    case 'UnaryExpression': {
      const operand = resolveCondition(expression.argument, scan);

      return expression.operator === 'not' && operand !== undefined
        ? !operand
        : undefined;
    }
    default:
      return undefined;
  }
};

const readFlag = (expression: Expression | undefined): boolean | undefined =>
  expression === undefined
    ? true
    : expression.type === 'BooleanLiteral'
      ? expression.value
      : undefined;

const readCall = (
  expression: Expression,
  scan: ScriptScan,
  isCertain: boolean,
  depth: number,
): void => {
  if (expression.type !== 'CallExpression' || expression.base.type !== 'Identifier') {
    return;
  }

  const { name: callee } = expression.base;
  const { arguments: args } = expression;
  const call = scan.calls.get(callee);

  if (call) {
    const name = readKnownValue(args[call.nameAt], scan);
    const pattern = typeof name === 'string' ? name : undefined;
    const flag = call.flagAt === undefined ? true : readFlag(args[call.flagAt]);

    if (isCertain && pattern !== undefined && flag !== undefined) {
      scan.found.rules.push({
        pattern,
        hide: call.hide === flag,
        isPermanent: call.isPermanent,
        source: scan.source,
      });
    } else {
      scan.found.conditional.push(`${pattern ?? 'a computed name'} (${scan.source})`);
    }
    return;
  }

  if (callee === 'ObjectGrantUpgrade' && isCertain) {
    const upgrade = readText(args[1]);

    if (upgrade !== undefined) {
      scan.found.grantedUpgrades.push({
        name: upgrade,
        at: scan.found.rules.length,
      });
    }
    return;
  }

  const helper = scan.functions.get(callee);

  if (helper && depth < MAX_CALL_DEPTH) {
    walkStatements(helper.body, scan, isCertain, depth + 1);
  }
};

/** Lists the blocks of a loop, which may or may not run */
const listLoopBodies = (statement: Statement): Statement[][] => {
  switch (statement.type) {
    case 'WhileStatement':
    case 'RepeatStatement':
    case 'ForNumericStatement':
    case 'ForGenericStatement':
      return [statement.body];
    default:
      return [];
  }
};

/** Remembers what a local or assignment leaves in its variables */
const trackVariables = (
  statement: LocalStatement | AssignmentStatement,
  scan: ScriptScan,
  isReached: boolean,
) => {
  statement.variables.forEach((variable, at) => {
    if (variable.type === 'Identifier') {
      const value = readKnownValue(statement.init[at], scan);

      if (isReached && value !== undefined) {
        scan.variables.set(variable.name, value);
      } else {
        scan.variables.delete(variable.name);
      }
    }
  });
};

/** Collects the calls of an `if`: a clause decided false is skipped, one decided true ends it */
const walkIfStatement = (
  statement: IfStatement,
  scan: ScriptScan,
  isCertain: boolean,
  depth: number,
): boolean => {
  let isDecided = isCertain;
  let mayReturn = false;

  for (const clause of statement.clauses) {
    const taken =
      clause.type === 'ElseClause' ? true : resolveCondition(clause.condition, scan);

    if (taken === false) {
      continue;
    }
    mayReturn =
      walkStatements(clause.body, scan, isDecided && taken === true, depth) || mayReturn;
    if (taken === true) {
      break;
    }
    isDecided = false;
  }
  return mayReturn;
};

/** Collects the calls of a block; true when it may return before its end */
const walkStatements = (
  statements: readonly Statement[],
  scan: ScriptScan,
  isCertain: boolean,
  depth: number,
): boolean => {
  let isReached = isCertain;
  let mayReturn = false;

  for (const statement of statements) {
    if (statement.type === 'ReturnStatement') {
      return true;
    }
    if (statement.type === 'CallStatement') {
      readCall(statement.expression, scan, isReached, depth);
    } else if (statement.type === 'DoStatement') {
      mayReturn = walkStatements(statement.body, scan, isReached, depth) || mayReturn;
    } else if (statement.type === 'IfStatement') {
      mayReturn = walkIfStatement(statement, scan, isReached, depth) || mayReturn;
    } else if (
      statement.type === 'LocalStatement' ||
      statement.type === 'AssignmentStatement'
    ) {
      trackVariables(statement, scan, isReached);
    } else {
      for (const body of listLoopBodies(statement)) {
        mayReturn = walkStatements(body, scan, false, depth) || mayReturn;
      }
    }
    isReached &&= !mayReturn;
  }
  return mayReturn;
};

/** Parses Lua 5.1; nothing when it does not parse or nests too deeply */
const parseLua = (text: string): Chunk | undefined => {
  try {
    return parse(text, { luaVersion: '5.1', comments: false, locations: false });
  } catch {
    return undefined;
  }
};

/**
 * Drops the INI comments a script is written with, `;` or `//` to the end of
 * the line, which Lua would read as code. Text in quotes is kept.
 */
const stripIniComments = (body: string): string =>
  body.replace(
    /("[^"\n]*"|'[^'\n]*')|;.*|\/\/.*/g,
    (match, quoted?: string) => quoted ?? '',
  );

const createFound = (): CreatedSubObjects => ({
  rules: [],
  conditional: [],
  grantedUpgrades: [],
});

/**
 * Reads the sub-object calls of an animation state's `BeginScript` body
 * @param source How the UI names the script
 * @param previousState The `StateName` the state is entered from, `null` for
 * none; left out, a condition on it stays undecided
 */
export const readStateScript = (
  body: string,
  source: string,
  previousState?: string | null,
): ScriptedSubObjects => {
  const found = createFound();

  if (!/SubObject/.test(body)) {
    return found;
  }

  const chunk = parseLua(stripIniComments(body));

  if (chunk) {
    walkStatements(
      chunk.body,
      {
        calls: DRAWABLE_CALLS,
        functions: new Map(),
        source,
        found,
        previousState,
        variables: new Map(),
      },
      true,
      0,
    );
  } else {
    found.conditional.push(`${source}, whose Lua could not be read`);
  }
  return found;
};

const readAttributes = (tag: string) =>
  new Map(
    [...tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, value]),
  );

/** Reads the `EventList`s of `scriptevents.xml`, each with its parent and handlers */
const readEventLists = (xml: string) => {
  const lists = new Map<string, { inherit?: string; handlers: Map<string, string> }>();
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');

  for (const [, tag, body] of text.matchAll(
    /<EventList\b([^>]*)>([\s\S]*?)<\/EventList>/g,
  )) {
    const attributes = readAttributes(tag);
    const handlers = new Map<string, string>();

    for (const [, handler] of body.matchAll(/<EventHandler\b([^>]*)>/g)) {
      const fields = readAttributes(handler);
      const event = fields.get('EventName');
      const script = fields.get('ScriptFunctionName');

      if (event && script && !handlers.has(event)) {
        handlers.set(event, script);
      }
    }
    lists.set(attributes.get('Name') ?? '', {
      inherit: attributes.get('Inherit'),
      handlers,
    });
  }
  return lists;
};

/**
 * Reads what the `OnCreated` handlers of an object's `AILuaEventsList` names do
 * to its sub-objects, following `Inherit` as the game does: a list's own
 * handler wins over its parent's.
 * @param eventsXml The text of `data/scripts/scriptevents.xml`
 * @param scriptsLua The text of `data/scripts/scripts.lua`
 */
export const readCreatedSubObjects = (
  listNames: readonly string[],
  eventsXml: string,
  scriptsLua: string,
): CreatedSubObjects => {
  const found = createFound();
  const lists = readEventLists(eventsXml);
  const chunk = parseLua(scriptsLua);

  if (!chunk) {
    found.conditional.push('scripts.lua, whose Lua could not be read');
    return found;
  }

  const functions = new Map(
    chunk.body.flatMap((statement) =>
      statement.type === 'FunctionDeclaration' &&
      statement.identifier?.type === 'Identifier'
        ? [[statement.identifier.name, statement] as const]
        : [],
    ),
  );

  for (const name of listNames) {
    let list = lists.get(name);

    for (let step = 0; list && step < MAX_INHERIT; step++) {
      const handler = list.handlers.get('OnCreated');

      if (handler) {
        walkStatements(
          functions.get(handler)?.body ?? [],
          {
            calls: OBJECT_CALLS,
            functions,
            source: `${handler} in scripts.lua`,
            found,
            previousState: undefined,
            variables: new Map(),
          },
          true,
          0,
        );
        break;
      }
      list = list.inherit === undefined ? undefined : lists.get(list.inherit);
    }
  }
  return found;
};
