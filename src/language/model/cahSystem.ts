import type { SageBlock, SageDocument } from "../../formats/ini/sageIniParser";

/**
 * What the `CreateAHeroSystem` block says about classes, subclasses, bling
 * groups and attribute points, read from a parsed INI file; the layout is
 * mint's `crates/sage/ini/src/create_a_hero.rs`. Names stay as written and
 * are resolved by the caller against the Upgrade, CommandButton and string
 * indexes.
 */

/** A block's own fields and nested blocks, keys lowercased */
export interface IniBlock {
  keyword: string;
  /** The header's values: the block's name, when it has one */
  values: string[];
  fields: Map<string, string[][]>;
  children: IniBlock[];
}

const readBlock = (block: SageBlock, document: SageDocument): IniBlock => {
  const header = document.statements.find(
    (statement) => statement.block === block,
  );
  const fields = new Map<string, string[][]>();

  for (const statement of document.statements) {
    const inside =
      statement.kind === "field" &&
      statement.line > block.startLine &&
      statement.line < block.endLine &&
      !block.children.some(
        (child) =>
          statement.line >= child.startLine && statement.line <= child.endLine,
      );

    if (inside) {
      const key = statement.keyword.text.toLowerCase();
      const lines = fields.get(key) ?? [];

      lines.push(statement.values.map((value) => value.text));
      fields.set(key, lines);
    }
  }

  return {
    keyword: block.keyword,
    values: header?.values.map((value) => value.text) ?? [],
    fields,
    children: block.children.map((child) => readBlock(child, document)),
  };
};

/** The block whose header sits on a line, with its fields */
export const blockAtLine = (
  document: SageDocument,
  line: number,
): IniBlock | undefined => {
  const find = (blocks: SageBlock[]): SageBlock | undefined => {
    for (const block of blocks) {
      if (block.startLine === line) {
        return block;
      }

      const inner = find(block.children);

      if (inner) {
        return inner;
      }
    }
    return undefined;
  };
  const block = find(document.blocks);

  return block && readBlock(block, document);
};

/** Every top-level block of a document with this keyword */
export const topBlocks = (
  document: SageDocument,
  keyword: string,
): IniBlock[] =>
  document.blocks
    .filter((block) => block.keyword.toLowerCase() === keyword.toLowerCase())
    .map((block) => readBlock(block, document));

const first = (block: IniBlock, key: string): string | undefined => {
  const value = block.fields.get(key.toLowerCase())?.[0]?.[0];

  return value && value.toLowerCase() !== "none" ? value : undefined;
};

const words = (block: IniBlock, key: string): string[] =>
  (block.fields.get(key.toLowerCase()) ?? [])
    .flat()
    .filter((word) => word.toLowerCase() !== "none");

/** `R:n G:n B:n [A:n]` as the packed word the file stores */
export const parseIniColor = (tokens: string[]): number | undefined => {
  const part = (tag: string): number | undefined => {
    const token = tokens.find((candidate) =>
      candidate.toUpperCase().startsWith(`${tag}:`),
    );
    const value = token ? Number(token.slice(2)) : NaN;

    return Number.isInteger(value) && value >= 0 && value <= 255
      ? value
      : undefined;
  };
  const red = part("R");
  const green = part("G");
  const blue = part("B");
  const alpha = tokens.some((token) => token.toUpperCase().startsWith("A:"))
    ? part("A")
    : 255;

  return red === undefined ||
    green === undefined ||
    blue === undefined ||
    alpha === undefined
    ? undefined
    : ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
};

export interface HeroBling {
  upgrade?: string;
  nameTag?: string;
  group?: string;
}

export interface HeroBinder {
  group?: string;
  labelTag?: string;
  slot?: number;
  isAttribute: boolean;
}

export interface HeroAttribute {
  group?: string;
  minUpgrade?: string;
  maxUpgrade?: string;
  defaultUpgrade?: string;
}

export interface HeroSubclass {
  upgrade?: string;
  nameTag?: string;
  points?: number;
  colors: (number | undefined)[];
  /** Upgrade names of every `BlingUpgrades` line, `@` marks removed */
  blingUpgrades: string[];
  attributes: HeroAttribute[];
}

export interface HeroClass {
  upgrade?: string;
  nameTag?: string;
  subclasses: HeroSubclass[];
}

export interface HeroSystem {
  classes: HeroClass[];
  binders: HeroBinder[];
  blings: HeroBling[];
}

const subclassOf = (block: IniBlock): HeroSubclass => ({
  upgrade: first(block, "UpgradeName"),
  nameTag: first(block, "NameTag"),
  points: Number.isInteger(Number(first(block, "SpendableAttributePoints")))
    ? Number(first(block, "SpendableAttributePoints"))
    : undefined,
  colors: [
    "DefaultPrimaryColor",
    "DefaultSecondaryColor",
    "DefaultTertiaryColor",
  ].map((key) => {
    const line = block.fields.get(key.toLowerCase())?.[0];

    return line && parseIniColor(line);
  }),
  blingUpgrades: words(block, "BlingUpgrades").map((name) =>
    name.startsWith("@") ? name.slice(1) : name,
  ),
  attributes: block.children
    .filter((child) => child.keyword.toLowerCase() === "attribute")
    .map((attribute) => ({
      group: first(attribute, "GroupName"),
      minUpgrade: first(attribute, "MinValueUpgrade"),
      maxUpgrade: first(attribute, "MaxValueUpgrade"),
      defaultUpgrade: first(attribute, "DefaultValueUpgrade"),
    })),
});

/** Merges every `CreateAHeroSystem` block of the given blocks, in order */
export const readHeroSystem = (systems: IniBlock[]): HeroSystem => {
  const system: HeroSystem = { classes: [], binders: [], blings: [] };

  for (const block of systems) {
    for (const child of block.children) {
      switch (child.keyword.toLowerCase()) {
        case "createaherobling":
          system.blings.push({
            upgrade: first(child, "BlingUpgradeName"),
            nameTag: first(child, "NameTag"),
            group: first(child, "GroupName"),
          });
          break;
        case "createaheroblingbinder":
          system.binders.push({
            group: first(child, "GroupName"),
            labelTag: first(child, "LabelTag"),
            slot: Number.isInteger(Number(first(child, "UISlot")))
              ? Number(first(child, "UISlot"))
              : undefined,
            isAttribute:
              first(child, "BlingType")?.toUpperCase() === "ATTRIBUTE",
          });
          break;
        case "createaheroclass":
          system.classes.push({
            upgrade: first(child, "UpgradeName"),
            nameTag: first(child, "NameTag"),
            subclasses: child.children
              .filter((sub) => sub.keyword.toLowerCase() === "subclass")
              .map(subclassOf),
          });
          break;
      }
    }
  }
  return system;
};

const same = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/**
 * The upgrades a bling group offers a subclass, in selection order: those
 * its `BlingUpgrades` lines name, plus every bling of an `Attribute` group of
 * the subclass, ordered by `GroupOrder` (file order where a bling has none).
 * Derived from mint's slot build, not read from the file.
 */
export const blingOptions = (
  system: HeroSystem,
  subclass: HeroSubclass | undefined,
  group: string,
  groupOrder: (upgrade: string) => number | undefined,
): string[] => {
  const inGroup = system.blings.filter((bling) => same(bling.group, group));
  const named = new Set(
    (subclass?.blingUpgrades ?? []).map((name) => name.toLowerCase()),
  );
  const isAttribute = subclass?.attributes.some((a) => same(a.group, group));
  const chosen = inGroup.filter(
    (bling) =>
      isAttribute ||
      (bling.upgrade !== undefined && named.has(bling.upgrade.toLowerCase())),
  );
  const options = (chosen.length || !subclass ? chosen : []).flatMap(
    (bling, order) =>
      bling.upgrade
        ? [
            {
              upgrade: bling.upgrade,
              key: groupOrder(bling.upgrade) ?? 0,
              order,
            },
          ]
        : [],
  );

  return options
    .sort((a, b) => a.key - b.key || a.order - b.order)
    .map((option) => option.upgrade);
};

/**
 * Attribute points a hero has spent: each attribute bling's index above the
 * index of its attribute's `MinValueUpgrade`. Derived, not stored in the file.
 */
export const spentPoints = (
  system: HeroSystem,
  subclass: HeroSubclass | undefined,
  blings: { group: string; index: number }[],
  groupOrder: (upgrade: string) => number | undefined,
): number => {
  let spent = 0;

  for (const attribute of subclass?.attributes ?? []) {
    const bling = blings.find((entry) => same(entry.group, attribute.group));

    if (!bling || !attribute.group) {
      continue;
    }

    const options = blingOptions(system, subclass, attribute.group, groupOrder);
    const min = Math.max(
      0,
      options.findIndex((option) => same(option, attribute.minUpgrade)),
    );

    spent += Math.max(0, bling.index - min);
  }
  return spent;
};
