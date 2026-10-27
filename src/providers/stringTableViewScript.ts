/**
 * Page code of the string table editor: a filterable table of labels and
 * their text, edited in place. The extension owns the data; the page sends
 * each change and is sent the table back.
 */
export const STRING_TABLE_SCRIPT = /* js */ `
const vscode = acquireVsCodeApi();
const PAGE = 200;
const state = { rows: [], hasSpeech: false, canReveal: false, filter: '', page: 0, editing: undefined };
const body = document.getElementById('rows');
const filter = document.getElementById('filter');
const count = document.getElementById('count');
const more = document.getElementById('more');

const matches = (row, text) => !text || row.label.toLowerCase().includes(text) || row.text.toLowerCase().includes(text) || (row.speech || '').toLowerCase().includes(text);

const cell = (text, className) => {
  const element = document.createElement('td');
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

/** Turns a cell into an editor; Enter commits a one-line field, Ctrl+Enter a text */
const editCell = (element, value, multiline, commit) => {
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.value = value;
  if (multiline) input.rows = Math.max(2, value.split(String.fromCharCode(10)).length);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.editing = undefined;
    // A text field reports every line break as LF, which is not an edit of CRLF text
    if (save && input.value !== value.replace(/\\r\\n?/g, String.fromCharCode(10))) commit(input.value);
    else show();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') finish(false);
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(true); }
  });
  input.addEventListener('blur', () => finish(true));
  element.replaceChildren(input);
  input.focus();
  input.select();
};

const show = () => {
  const text = state.filter.toLowerCase();
  const visible = state.rows.filter((row) => matches(row, text));
  const shown = visible.slice(0, (state.page + 1) * PAGE);
  count.textContent = visible.length === state.rows.length ? state.rows.length + ' labels' : visible.length + ' of ' + state.rows.length + ' labels';
  more.hidden = shown.length >= visible.length;
  document.getElementById('speechHead').hidden = !state.hasSpeech;
  body.replaceChildren(...shown.map((row) => {
    const tr = document.createElement('tr');
    if (row.problems && row.problems.length) tr.className = 'problem';
    const label = cell(row.label, 'label');
    if (row.problems && row.problems.length) label.title = row.problems.join('; ');
    label.ondblclick = () => editCell(label, row.label, false, (value) => vscode.postMessage({ kind: 'setLabel', id: row.id, label: row.label, value }));
    const textCell = cell(row.text, 'text' + (row.hasText === false ? ' missing' : ''));
    if (row.extra) textCell.title = row.extra + ' more string(s) under this label, which the game does not read';
    textCell.ondblclick = () => editCell(textCell, row.text, true, (value) => vscode.postMessage({ kind: 'setText', id: row.id, label: row.label, value }));
    tr.append(label, textCell);
    if (state.hasSpeech) {
      const speech = cell(row.speech ?? '', 'speech');
      speech.ondblclick = () => editCell(speech, row.speech ?? '', false, (value) => vscode.postMessage({ kind: 'setSpeech', id: row.id, label: row.label, value }));
      tr.append(speech);
    }
    const actions = document.createElement('td');
    actions.className = 'actions';
    if (state.canReveal) {
      const reveal = document.createElement('button');
      reveal.textContent = '↗';
      reveal.title = 'Show in the text';
      reveal.onclick = () => vscode.postMessage({ kind: 'reveal', id: row.id });
      actions.append(reveal);
    }
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Remove this label';
    remove.onclick = () => vscode.postMessage({ kind: 'remove', id: row.id, label: row.label });
    actions.append(remove);
    tr.append(actions);
    return tr;
  }));
};

filter.addEventListener('input', () => { state.filter = filter.value; state.page = 0; show(); });
more.addEventListener('click', () => { state.page += 1; show(); });
document.getElementById('add').addEventListener('submit', (event) => {
  event.preventDefault();
  const label = document.getElementById('newLabel');
  const text = document.getElementById('newText');
  if (!label.value.trim()) return;
  vscode.postMessage({ kind: 'add', label: label.value.trim(), value: text.value });
  label.value = '';
  text.value = '';
});

window.addEventListener('message', ({ data }) => {
  if (data.kind === 'table') {
    state.rows = data.rows;
    state.hasSpeech = data.hasSpeech;
    state.canReveal = data.canReveal;
    document.getElementById('summary').textContent = data.summary;
    show();
  } else if (data.kind === 'notice') {
    const notice = document.getElementById('notice');
    notice.textContent = data.message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6000);
  }
});

vscode.postMessage({ kind: 'ready' });
`;
