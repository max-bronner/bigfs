/**
 * Uri scheme the file system provider is registered under, and the prefix on
 * every command id and context key, which `package.json` repeats literally.
 */
export const SCHEME = 'bigfs';

/** Glob the workspace scan and the file watcher both match archives on */
export const ARCHIVE_GLOB = '**/*.big';

/**
 * Language id the SAGE INI grammar and providers are registered under, which
 * `package.json` repeats literally.
 */
export const SAGE_INI_LANGUAGE = 'sage-ini';

/**
 * View type the preview editor for textures, audio and models is registered
 * under, which `package.json` repeats and the INI asset links open with.
 */
export const PREVIEW_VIEW_TYPE = 'bigfs.preview';
