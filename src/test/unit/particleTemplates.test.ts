import * as assert from 'assert';
import {
  findParticleDefinitions,
  findNumericFields,
  readParticleDef,
} from '../../formats/particles/particleIni';
import {
  PARTICLE_TEMPLATES,
  createTemplateSnippet,
} from '../../formats/particles/particleTemplates';
import { ParticleWorld } from '../../formats/particles/particleSimulation';

/** A snippet with each tab stop at its default */
const resolve = (snippet: string) =>
  snippet.replace(/\$\{\d+:([^}]*)\}/g, '$1');

suite('Particle templates', () => {
  test('each reads back as one system that emits', () => {
    for (const template of PARTICLE_TEMPLATES) {
      const text = resolve(createTemplateSnippet(template, 'FX_Test'));
      const [definition, ...rest] = findParticleDefinitions(text);

      assert.strictEqual(rest.length, 0, template.label);
      assert.ok(findNumericFields(definition).length > 10, template.label);

      const def = readParticleDef(definition);
      const world = new ParticleWorld(
        { findSystem: () => def, findFxList: () => undefined },
        1,
      );

      world.spawn('FX_Test', [0, 0, 0]);
      for (let frame = 0; frame < 5; frame++) {
        world.step();
      }
      assert.ok(def.particleName?.endsWith('.tga'), template.label);
      assert.ok(world.liveParticles > 0, template.label);
    }
  });
});
