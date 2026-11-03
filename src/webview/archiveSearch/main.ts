import { createDebouncer } from '../../core/debounce';
import { formatCount } from '../../core/messages';
import type { PreviewLine } from '../../core/collectLineMatches';
import { element } from '../shared/element';
import { getVsCodeApi } from '../shared/vscodeApi';
import type {
  FileResult,
  FromSearchPage,
  SearchSummary,
  ToSearchPage,
} from './protocol';

/**
 * The search view's page: the query box and its toggles, and the results as
 * archives, files and the lines that matched with the lines around them. The
 * host runs the search; this page sends the request and draws what streams
 * back, ignoring anything from a search that has been replaced.
 */

/** Pause after the last keystroke before the search starts by itself */
const TYPING_DELAY = 350;

const vscode = getVsCodeApi<FromSearchPage>();

const byId = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const queryBox = byId<HTMLInputElement>('query');
const includeBox = byId<HTMLInputElement>('include');
const excludeBox = byId<HTMLInputElement>('exclude');
const contextBox = byId<HTMLInputElement>('context');
const toggles = {
  caseSensitive: byId<HTMLButtonElement>('case'),
  wholeWord: byId<HTMLButtonElement>('word'),
  regex: byId<HTMLButtonElement>('regex'),
};
const cancelButton = byId<HTMLButtonElement>('cancel');
const statusLine = byId<HTMLElement>('status');
const notes = byId<HTMLElement>('notes');
const results = byId<HTMLElement>('results');

/** The part of the page state that survives the view being closed */
interface SavedState {
  text: string;
  include: string;
  exclude: string;
  contextLines: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** One archive's heading and the box its files are added to */
interface ArchiveGroup {
  files: HTMLElement;
  badge: HTMLElement;
  matchCount: number;
}

let searchId = 0;
let isRunning = false;
let totalFiles = 0;
let totalMatches = 0;
let groups = new Map<string, ArchiveGroup>();

const isOn = (button: HTMLButtonElement): boolean =>
  button.getAttribute('aria-pressed') === 'true';

const save = (): void => {
  const state: SavedState = {
    text: queryBox.value,
    include: includeBox.value,
    exclude: excludeBox.value,
    contextLines: contextBox.value,
    caseSensitive: isOn(toggles.caseSensitive),
    wholeWord: isOn(toggles.wholeWord),
    regex: isOn(toggles.regex),
  };

  vscode.setState(state);
};

const setStatus = (text: string, isError = false): void => {
  statusLine.textContent = text;
  statusLine.classList.toggle('error', isError);
};

/** Builds a line's text with each match in a highlight */
const renderLineText = ({ text, ranges = [] }: PreviewLine): HTMLElement => {
  const span = element('span', undefined, 'text');
  let at = 0;

  for (const [start, end] of ranges) {
    if (start >= at) {
      span.append(
        text.slice(at, start),
        element('mark', text.slice(start, end)),
      );
      at = end;
    }
  }

  span.append(text.slice(at));

  return span;
};

/** Makes a heading that folds the box below it, by click or by Enter */
const makeFoldable = (heading: HTMLElement, body: HTMLElement): void => {
  const twisty = element('span', '▾', 'twisty');
  const toggle = (): void => {
    body.hidden = !body.hidden;
    twisty.textContent = body.hidden ? '▸' : '▾';
  };

  heading.prepend(twisty);
  heading.tabIndex = 0;
  heading.addEventListener('click', toggle);
  heading.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
};

const getGroup = (file: FileResult): ArchiveGroup => {
  const key = `${file.archiveFolder}${file.archive}`;
  let group = groups.get(key);

  if (!group) {
    const heading = element('div', undefined, 'archive');
    const files = element('div');
    const badge = element('span', '0', 'badge');

    heading.append(
      element('span', file.archive, 'name'),
      element('span', file.archiveFolder, 'detail'),
      badge,
    );
    makeFoldable(heading, files);
    results.append(heading, files);
    group = { files, badge, matchCount: 0 };
    groups.set(key, group);
  }

  return group;
};

const renderFile = (file: FileResult): void => {
  const group = getGroup(file);
  const heading = element('div', undefined, 'file');
  const blocks = element('div');
  const folder = file.entryPath.slice(0, file.entryPath.lastIndexOf('/') + 1);

  heading.title = `${file.archive}/${file.entryPath}`;
  heading.append(
    element('span', file.entryPath.slice(folder.length), 'name'),
    element('span', folder, 'detail'),
    element('span', String(file.matchCount), 'badge'),
  );
  makeFoldable(heading, blocks);

  for (const block of file.blocks) {
    const box = element('div', undefined, 'block');

    for (const line of block.lines) {
      const row = element('div', undefined, line.ranges ? 'line hit' : 'line');
      const [start, end] = line.selection ?? [0, 0];

      row.append(
        element('span', String(line.line + 1), 'number'),
        renderLineText(line),
      );
      row.addEventListener('click', () =>
        vscode.postMessage({
          kind: 'open',
          uri: file.uri,
          line: line.line,
          start,
          end,
        }),
      );
      box.append(row);
    }

    blocks.append(box);
  }

  group.files.append(heading, blocks);
  group.matchCount += file.matchCount;
  group.badge.textContent = String(group.matchCount);
  totalFiles += 1;
  totalMatches += file.matchCount;
};

const describeProgress = (archive?: string): string =>
  `${formatCount(totalMatches, 'result')} in ${formatCount(totalFiles, 'file')}${archive ? ` · searching ${archive}` : ''}`;

const finish = (summary: SearchSummary): void => {
  isRunning = false;
  cancelButton.hidden = true;

  if (!summary.matchCount) {
    setStatus(
      summary.isCancelled
        ? 'Search cancelled.'
        : `No results in ${formatCount(summary.searchedCount, 'text file')}.`,
    );
  } else {
    setStatus(
      `${describeProgress()}${summary.isCancelled ? ' · cancelled' : ''}`,
    );
  }

  notes.textContent = [
    summary.isLimitHit
      ? `Stopped at the first ${summary.matchCount} results; narrow the query or the files to include.`
      : '',
    summary.isPatternSlow
      ? `Stopped: the pattern took too long on ${formatCount(summary.slowCount, 'file')}. It probably backtracks without end.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
};

const startSearch = (): void => {
  save();

  if (!queryBox.value) {
    vscode.postMessage({ kind: 'cancel' });
    searchId += 1;
    isRunning = false;
    cancelButton.hidden = true;
    results.replaceChildren();
    notes.textContent = '';
    setStatus('');
    return;
  }

  searchId += 1;
  isRunning = true;
  totalFiles = 0;
  totalMatches = 0;
  groups = new Map();
  results.replaceChildren();
  notes.textContent = '';
  cancelButton.hidden = false;
  setStatus('Searching...');
  vscode.postMessage({
    kind: 'search',
    id: searchId,
    request: {
      query: {
        text: queryBox.value,
        caseSensitive: isOn(toggles.caseSensitive),
        wholeWord: isOn(toggles.wholeWord),
        regex: isOn(toggles.regex),
      },
      include: includeBox.value,
      exclude: excludeBox.value,
      contextLines: Math.max(0, Math.min(10, Number(contextBox.value) || 0)),
    },
  });
};

const typing = createDebouncer(startSearch, TYPING_DELAY);

window.addEventListener('message', ({ data }: MessageEvent<ToSearchPage>) => {
  if (data.kind === 'focus') {
    if (data.query) {
      queryBox.value = data.query;
      startSearch();
    }

    queryBox.focus();
    queryBox.select();
    return;
  }

  if (data.id !== searchId) {
    return;
  }

  switch (data.kind) {
    case 'progress':
      setStatus(describeProgress(data.archive));
      break;
    case 'files':
      data.files.forEach(renderFile);
      break;
    case 'finished':
      finish(data.summary);
      break;
    case 'failed':
      isRunning = false;
      cancelButton.hidden = true;
      setStatus(data.message, true);
      break;
  }
});

for (const box of [queryBox, includeBox, excludeBox, contextBox]) {
  box.addEventListener('input', () => typing.schedule());
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      typing.cancel();
      startSearch();
    }
  });
}

for (const button of Object.values(toggles)) {
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(!isOn(button)));
    typing.cancel();
    startSearch();
  });
}

cancelButton.addEventListener('click', () => {
  if (isRunning) {
    vscode.postMessage({ kind: 'cancel' });
    searchId += 1;
    isRunning = false;
    cancelButton.hidden = true;
    setStatus(`${describeProgress()} · cancelled`);
  }
});

const saved = vscode.getState() as SavedState | undefined;

if (saved) {
  queryBox.value = saved.text;
  includeBox.value = saved.include;
  excludeBox.value = saved.exclude;
  contextBox.value = saved.contextLines;
  toggles.caseSensitive.setAttribute(
    'aria-pressed',
    String(saved.caseSensitive),
  );
  toggles.wholeWord.setAttribute('aria-pressed', String(saved.wholeWord));
  toggles.regex.setAttribute('aria-pressed', String(saved.regex));
}

vscode.postMessage({ kind: 'ready' });
