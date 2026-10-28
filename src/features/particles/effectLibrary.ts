import type * as vscode from 'vscode';
import type { EntryLocator } from '../services/entryLocator';
import {
  findParticleDefinitions,
  readFxList,
  readParticleDef,
  referencedNames,
} from '../formats/particles/particleIni';
import type {
  FxListDef,
  IniDefinition,
  ParticleDef,
} from '../formats/particles/particleIni';
import { encodePng } from '../node/png';
import { decodeDds, decodeTga } from '../formats/texture/textureTools';
import type { SageIniIndex } from '../services/ini/sageIniIndex';
import { readWorkspaceText } from '../services/ini/workspaceText';

/**
 * The definitions and textures an effect needs to play: every particle
 * system and FX list it reaches through its references, found in the file
 * it is written in first and then anywhere indexed, and every texture
 * those systems draw with, as data URIs for the preview page.
 */

/** References followed at most, so a loop of FX lists ends */
const MAX_REFERENCES = 64;

export interface EffectSet {
  /** By lowercased name */
  systems: Record<string, ParticleDef>;
  fxLists: Record<string, FxListDef>;
  /** Data URIs by lowercased texture name; null for one not found */
  textures: Record<string, string | null>;
  notes: string[];
}

export class EffectLibrary {
  private readonly textures = new Map<string, Promise<string | null>>();

  public constructor(
    private readonly index: SageIniIndex,
    private readonly locator: EntryLocator | undefined,
    private readonly near: vscode.Uri,
  ) {}

  /** Finds a definition: `localText` first, then everything indexed */
  public async lookUp(
    name: string,
    keywords: string[],
    localText = '',
  ): Promise<IniDefinition | undefined> {
    const matches = (definition: IniDefinition) =>
      definition.name.toLowerCase() === name.toLowerCase() &&
      keywords.includes(definition.keyword);
    const local = findParticleDefinitions(localText).find(matches);

    if (local) {
      return local;
    }
    for (const keyword of keywords) {
      for (const place of this.index.findDefinitions(keyword, name)) {
        const found = findParticleDefinitions(
          await readWorkspaceText(place.uri),
        ).find(matches);

        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  /**
   * Everything `roots` reach, and the definitions `names` give with what
   * they reach; `localText` is where a name is looked for first
   */
  public async collect(
    roots: (ParticleDef | FxListDef)[],
    names: { name: string; list: boolean }[],
    localText = '',
    limit = MAX_REFERENCES,
  ): Promise<EffectSet> {
    await this.index.whenReady();

    const systems: Record<string, ParticleDef> = {};
    const fxLists: Record<string, FxListDef> = {};
    const notes = new Set<string>();
    const queue = [...names];
    const visit = (def: ParticleDef | FxListDef) => {
      const { systems: reached, fxLists: lists } = referencedNames(def);

      reached.forEach((name) => queue.push({ name, list: false }));
      lists.forEach((name) => queue.push({ name, list: true }));
    };

    for (const root of roots) {
      if ('nuggets' in root) {
        fxLists[root.name.toLowerCase()] = root;
      } else {
        systems[root.name.toLowerCase()] = root;
      }
      visit(root);
    }

    for (let count = 0; queue.length && count < limit; count++) {
      const next = queue.shift()!;
      const table = next.list ? fxLists : systems;

      if (table[next.name.toLowerCase()]) {
        continue;
      }

      // Reading (i) of particles.md §2c: the block form wins over the flat
      const found = await this.lookUp(
        next.name,
        next.list ? ['FXList'] : ['FXParticleSystem', 'ParticleSystem'],
        localText,
      );

      if (!found) {
        notes.add(
          `${next.list ? 'FX list' : 'Particle system'} ${next.name} was not found`,
        );
        continue;
      }

      const def = next.list ? readFxList(found) : readParticleDef(found);

      table[next.name.toLowerCase()] = def as ParticleDef & FxListDef;
      visit(def);
    }

    for (const list of Object.values(fxLists)) {
      const listed = [
        ...new Set(
          list.effects
            .filter((effect) => !effect.approximation)
            .map((effect) => effect.slot),
        ),
      ];

      if (listed.length) {
        notes.add(
          `${list.name}: ${listed.join(', ')} only listed on the timeline; ParticleSystem and Sound nuggets play, LightPulse, ViewShake and TerrainScorch are approximated`,
        );
      }
    }

    const textures: Record<string, string | null> = {};

    for (const def of Object.values(systems)) {
      if (def.type === 'DRAWABLE') {
        notes.add(
          `${def.name} draws the model ${def.particleName ?? '?'}; shown as markers`,
        );
        continue;
      }
      if (def.type === 'STREAK') {
        notes.add(`${def.name} is a streak; shown as sprites`);
      }
      if (def.volume.type === 'unread') {
        notes.add(
          `${def.name}: ${def.volume.module} emits from its centre here`,
        );
      }
      if (def.particleName) {
        const texture = await this.texture(def.particleName);

        textures[def.particleName.toLowerCase()] = texture;
        if (!texture) {
          notes.add(
            `Texture ${def.particleName} was not found; a soft dot stands in`,
          );
        }
      }
    }
    return { systems, fxLists, textures, notes: [...notes] };
  }

  private texture(name: string): Promise<string | null> {
    const key = name.toLowerCase();
    let entry = this.textures.get(key);

    if (!entry) {
      entry = (async () => {
        if (!this.locator) {
          return null;
        }
        for (const candidate of [name.replace(/\.[^.]*$/, '.dds'), name]) {
          const bytes = await this.locator.read(candidate, this.near);

          if (bytes) {
            const image = (
              /\.dds$/i.test(candidate) ? decodeDds(bytes) : decodeTga(bytes)
            ).levels[0];

            return `data:image/png;base64,${Buffer.from(encodePng(image)).toString('base64')}`;
          }
        }
        return null;
      })().catch(() => null);
      this.textures.set(key, entry);
    }
    return entry;
  }
}
