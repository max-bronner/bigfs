import type { ExtensionContext } from 'vscode';
import { createServices } from './services/createServices';
import type { Services } from './services/createServices';
import { registerPreview } from './features/preview';
import { registerBulkEdit } from './features/bulkEdit';
import { registerObjects } from './features/objects';
import { registerParticles } from './features/particles';
import { registerAudio } from './features/audio';
import { registerBalanceSheet } from './features/balanceSheet';
import { registerArmorTable } from './features/armorTable';
import { registerCommandSet } from './features/commandSet';
import { registerIniLanguage } from './features/iniLanguage';
import { registerMap } from './features/map';
import { registerScripts } from './features/scripts';
import { registerCah } from './features/cah';
import { registerApt } from './features/apt';
import { registerStrings } from './features/strings';
import { registerTranslations } from './features/translations';
import { registerWnd } from './features/wnd';
import { registerTextures } from './features/textures';
import { registerW3d } from './features/w3d';
import { registerVideo } from './features/video';
import { registerInstalls } from './features/installs';
import { registerMods } from './features/mods';
import { registerExplorer } from './features/explorer';

/**
 * Every feature, in activation order. Providers of one kind for the same
 * language are consulted in registration order, so the INI features that
 * add lenses and code actions come before `registerIniLanguage`, and the
 * object preview's lens follows the effective object lens.
 */
const FEATURES: ((context: ExtensionContext, services: Services) => void)[] = [
  registerPreview,
  registerBulkEdit,
  registerObjects,
  registerParticles,
  registerAudio,
  registerBalanceSheet,
  registerArmorTable,
  registerCommandSet,
  registerIniLanguage,
  registerMap,
  registerScripts,
  registerCah,
  registerApt,
  registerStrings,
  registerTranslations,
  registerWnd,
  registerTextures,
  registerW3d,
  registerVideo,
  registerInstalls,
  registerMods,
  registerExplorer,
];

/** Activation hook VS Code calls once, at startup or on the first `bigfs` uri */
export function activate(context: ExtensionContext): void {
  const services = createServices(context);

  for (const register of FEATURES) {
    register(context, services);
  }
}

/**
 * Shutdown hook VS Code calls when the extension is unloaded. Empty because
 * everything `activate` registers is disposed through `context.subscriptions`.
 */
export function deactivate() {}
