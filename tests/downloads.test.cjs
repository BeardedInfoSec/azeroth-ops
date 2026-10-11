const test = require('node:test');
const assert = require('node:assert/strict');

// Small DOM/state fixtures only. No browser, renderer, database, or game assets.
function documentFixture() {
  const nodes = new Map();
  function element() {
    return {dataset: {}, children: [], events: {}, hidden: false, disabled: false, open: false, textContent: '',
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this.events[key] = fn; },
      append(...children) { this.children.push(...children); },
      remove() { this.removed = true; },
      showModal() { this.open = true; }, close() { this.open = false; }};
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  return {get, document: {getElementById: get, createElement: element, querySelectorAll: () => [get('solo-launch'), get('lobby-launch')]}};
}
function state(id = 'stormwind', extra = {}) {
  return {id, name: id === 'core' ? 'Shared gear' : 'Stormwind', totalBytes: 10240, cachedBytes: 0, totalFiles: 10, cachedFiles: 0, complete: false, available: true, ...extra};
}
async function fixture(t) {
  const {DownloadsView} = await import('../src/downloads.mjs');
  const dom = documentFixture();
  const cache = {warnings: [], states: [state('core'), state()], listeners: [],
    subscribe(fn) { this.listeners.push(fn); return () => { this.unsubscribed = true; }; },
    async catalog(options) { this.catalogOptions = options; if (this.error) throw this.error; },
    async statuses() { return this.states.map(item => ({...item})); }};
  const view = new DownloadsView({cache, document: dom.document});
  t.after(() => view.dispose());
  return {...dom, cache, view};
}

test('Menus open a modal and completed/partial downloads have accurate controls', async t => {
  const {cache, view, get} = await fixture(t);
  cache.states[0] = state('core', {cachedBytes: 10240, cachedFiles: 10, complete: true});
  cache.states[1] = state('stormwind', {cachedBytes: 1024, cachedFiles: 1});
  await get('lobby-launch').events.click();
  assert.equal(view.dialog.open, true);
  assert.equal(view.rows.get('core').download.disabled, true);
  assert.equal(view.rows.get('core').remove.hidden, true);
  assert.equal(view.rows.get('stormwind').download.textContent, 'RESUME DOWNLOAD');
  assert.match(view.rows.get('stormwind').detail.textContent, /9\.0 KB remaining/);
  const row = view.rows.get('stormwind');
  await view.sync();
  assert.equal(view.rows.get('stormwind'), row, 'progress updates preserve button focus and DOM nodes');
  get('downloads-close').events.click();
  assert.equal(view.dialog.open, false);
});

test('Cancel keeps saved progress, enables resume, and prevents simultaneous downloads', async t => {
  const {cache, view} = await fixture(t);
  await view.open();
  let calls = 0, ready;
  const started = new Promise(resolve => { ready = resolve; });
  cache.download = async (id, {signal, onProgress}) => {
    calls++;
    cache.states[1] = state(id, {cachedBytes: 2048, cachedFiles: 2});
    onProgress({...cache.states[1]});
    ready();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true}));
  };
  const pending = view.download('stormwind');
  await started;
  assert.equal(view.rows.get('stormwind').download.textContent, 'CANCEL');
  assert.equal(view.rows.get('core').download.disabled, true);
  assert.equal(view.clearButton.disabled, true);
  await view.download('core');
  assert.equal(calls, 1);
  view.rows.get('stormwind').download.events.click();
  await pending;
  assert.equal(view.job, null);
  assert.match(view.message.textContent, /canceled.*Saved files are kept/);
  assert.equal(view.rows.get('stormwind').download.textContent, 'RESUME DOWNLOAD');
  assert.equal(view.rows.get('stormwind').progress.value, 2048);
});

test('Completed transfer reports saved; storage failure never reports downloaded', async t => {
  const {cache, view} = await fixture(t);
  await view.open();
  cache.download = async id => {
    cache.states[1] = state(id, {cachedFiles: 10, cachedBytes: 10240, complete: true});
    return cache.states[1];
  };
  await view.download('stormwind');
  assert.equal(view.rows.get('stormwind').download.textContent, 'DOWNLOADED');
  assert.match(view.message.textContent, /is saved in this browser/);
  cache.states[1] = state();
  cache.warnings = ['Browser storage is full.'];
  cache.download = async () => { throw new Error('Browser storage is full.'); };
  await view.sync();
  await view.download('stormwind');
  assert.equal(view.message.dataset.error, 'true');
  assert.match(view.message.textContent, /Download stopped/);
  assert.equal(view.rows.get('stormwind').download.textContent, 'DOWNLOAD');
  assert.equal(view.warning.hidden, false);
});

test('Unavailable map is explained; failed catalog checks can be retried', async t => {
  const {cache, view} = await fixture(t);
  cache.error = new Error('Host unavailable');
  await view.open();
  assert.match(view.message.textContent, /Host unavailable/);
  assert.equal(view.refreshButton.disabled, false);
  cache.error = null;
  cache.states[1] = state('stormwind', {available: false, unavailableReason: 'Import Stormwind on the host.'});
  await view.refresh(true);
  assert.equal(cache.catalogOptions.refresh, true);
  assert.equal(view.rows.get('stormwind').download.disabled, true);
  assert.match(view.rows.get('stormwind').detail.textContent, /Import Stormwind/);
});

test('Removal routes to the selected city or all game downloads and refreshes counts', async t => {
  const {cache, view} = await fixture(t);
  cache.states[1] = state('stormwind', {cachedFiles: 10, cachedBytes: 10240, complete: true});
  cache.remove = async id => { cache.removed = id; cache.states[1] = state(); };
  cache.clear = async () => { cache.cleared = true; cache.states = [state('core'), state()]; };
  await view.open();
  await view.remove('stormwind');
  assert.equal(cache.removed, 'stormwind');
  assert.match(view.message.textContent, /shared with other cities are kept/);
  assert.equal(view.rows.get('stormwind').progress.value, 0);
  await view.remove();
  assert.equal(cache.cleared, true);
  assert.match(view.message.textContent, /saved classes are unchanged/);
  assert.equal(view.clearButton.disabled, true);
});

test('Storage sizes remain readable from bytes to gigabytes', async () => {
  const {formatBytes} = await import('../src/downloads.mjs');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 ** 2 * 12.5), '12.5 MB');
  assert.equal(formatBytes(1024 ** 3 * 1.2), '1.2 GB');
});
