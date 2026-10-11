const test = require('node:test');
const assert = require('node:assert/strict');

class MemoryStore {
  constructor() { this.records = new Map(); this.settings = new Map(); this.payloadReads = 0; this.puts = 0; }
  async get(url) { this.payloadReads++; return this.records.get(url); }
  async metadata() { return [...this.records.values()].map(({ blob, ...metadata }) => metadata); }
  async put(record) { this.puts++; if (this.failWrite) throw this.failWrite; this.records.set(record.url, record); }
  async delete(urls) { for (const url of urls) this.records.delete(url); }
  async clear() { this.records.clear(); }
  async setting(key, value) { if (arguments.length > 1) this.settings.set(key, value); return this.settings.get(key); }
}

// A tiny transaction/request fixture, not an IndexedDB reimplementation. It
// executes the actual adapter's callbacks and commits both stores together.
function transactionDatabase() {
  const data = new Map(['metadata', 'blobs', 'settings'].map(name => [name, new Map()]));
  const db = { data, transactions: [], failStore: null };
  db.transaction = (names, mode) => {
    const staged = new Map(names.map(name => [name, new Map(data.get(name))]));
    const tx = { names, mode, operations: [], error: null };
    db.transactions.push(tx);
    let pending = 0, finished = false;
    tx.abort = () => {
      if (finished) return;
      finished = true;
      queueMicrotask(() => tx.onabort?.());
    };
    const request = (name, operation, run) => {
      const result = {};
      tx.operations.push({ name, operation });
      pending++;
      queueMicrotask(() => {
        if (finished) return;
        if (db.failStore === name && operation === 'put') {
          tx.error = new DOMException('Fixture quota failure', 'QuotaExceededError');
          finished = true; tx.onerror?.(); tx.onabort?.(); return;
        }
        result.result = run(staged.get(name));
        result.onsuccess?.();
        if (--pending === 0) queueMicrotask(() => {
          if (finished || pending) return;
          finished = true;
          if (mode === 'readwrite') for (const name of names) data.set(name, staged.get(name));
          tx.oncomplete?.();
        });
      });
      return result;
    };
    tx.objectStore = name => {
      assert.ok(names.includes(name), 'store must belong to transaction');
      return {
        get: key => request(name, 'get', store => store.get(key)),
        getAll: () => request(name, 'getAll', store => [...store.values()]),
        put: (value, key) => request(name, 'put', store => { store.set(key, value); return key; }),
        delete: key => request(name, 'delete', store => store.delete(key)),
        clear: () => request(name, 'clear', store => store.clear()),
      };
    };
    return tx;
  };
  return db;
}

const catalog = revision => ({ version: revision, assets: [
  { url: '/assets/core.bin', revision: 'core-1', size: 4, type: 'application/octet-stream' },
  { url: '/assets/shared.png', revision: 'shared-1', size: 2, type: 'image/png' },
  { url: '/assets/a.json', revision, size: 3, type: 'application/json' },
  { url: '/assets/b.json', revision: 'b-1', size: 3, type: 'application/json' },
], packs: [
  { id: 'core', name: 'Shared files', assets: ['/assets/core.bin'] },
  { id: 'a', name: 'A', assets: ['/assets/a.json', '/assets/shared.png'] },
  { id: 'b', name: 'B', assets: ['/assets/b.json', '/assets/shared.png'] },
] });

async function fixture(options = {}) {
  const { AssetCache } = await import('../src/asset-cache.mjs');
  const store = options.store || new MemoryStore(), requests = [];
  let manifest = catalog('a-1'), failure;
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (failure) return failure(url, init);
    if (url === '/api/assets/manifest') return Response.json(manifest);
    const asset = manifest.assets.find(asset => asset.url === url);
    return new Response('x'.repeat(asset?.size || 1), { headers: { 'Content-Type': asset?.type || 'text/plain' } });
  };
  const cache = new AssetCache({ store, fetchImpl, concurrency: options.concurrency || 2 });
  return { cache, store, requests, setManifest: value => { manifest = value; }, setFailure: value => { failure = value; } };
}

test('regular loads save bytes, reuse exact revisions, and refresh only changed files', async () => {
  const f = await fixture();
  assert.equal(await (await f.cache.fetch('/assets/a.json')).text(), 'xxx');
  assert.equal(await (await f.cache.fetch('/assets/a.json')).text(), 'xxx');
  assert.equal(f.requests.filter(request => request.url === '/assets/a.json').length, 1);
  assert.equal(f.requests[0].init.cache, 'no-store');
  assert.equal(f.requests.find(request => request.url === '/assets/a.json').init.cache, 'no-cache');
  f.setManifest(catalog('a-2'));
  await f.cache.catalog({ refresh: true });
  await f.cache.fetch('/assets/a.json');
  assert.equal(f.requests.filter(request => request.url === '/assets/a.json').length, 2);
  assert.equal(f.requests.filter(request => request.url === '/assets/a.json').at(-1).init.cache, 'no-cache', 'changed revision cannot reuse a fresh old HTTP cache response');
  assert.equal(f.store.records.get('/assets/a.json').revision, 'a-2');
});

test('simultaneous reads share one network transfer and produce independently readable responses', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.cache.fetch('/assets/a.json')));
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), Array(8).fill('xxx'));
  assert.equal(f.requests.filter(request => request.url === '/assets/a.json').length, 1);
  assert.equal(f.store.puts, 1);
});

test('pack downloads include shared core and status reads metadata without loading blob payloads', async () => {
  const f = await fixture(), progress = [];
  const result = await f.cache.download('a', { onProgress: value => progress.push(value) });
  assert.equal(result.complete, true);
  assert.equal(result.downloading, false);
  assert.equal(result.cachedFiles, 3);
  assert.equal(result.totalBytes, 9);
  assert.ok(progress.some(value => value.cachedFiles === 0));
  const payloadReads = f.store.payloadReads;
  assert.equal((await f.cache.status('a')).cachedBytes, 9);
  assert.equal(f.store.payloadReads, payloadReads);
  const count = f.requests.length;
  await f.cache.download('a');
  assert.equal(f.requests.length, count, 'repeat download has no network requests');
});

test('canceled download retains finished files and resumes only missing assets', async () => {
  const f = await fixture({ concurrency: 1 }), controller = new AbortController();
  await assert.rejects(f.cache.download('a', { signal: controller.signal, onProgress: value => {
    if (value.cachedFiles === 1) controller.abort();
  } }), { name: 'AbortError' });
  assert.equal((await f.cache.status('a')).cachedFiles, 1);
  await f.cache.download('a');
  assert.equal((await f.cache.status('a')).complete, true);
  assert.equal(f.requests.filter(request => request.url === '/assets/core.bin').length, 1);
});

test('canceling one deduplicated reader does not abort another reader', async () => {
  const f = await fixture();
  await f.cache.catalog();
  let resolveNetwork;
  f.setFailure((url, init) => new Promise((resolve, reject) => {
    resolveNetwork = () => resolve(new Response('xxx'));
    init.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')));
  }));
  const controller = new AbortController();
  const canceled = f.cache.fetch('/assets/a.json', { signal: controller.signal });
  const continuing = f.cache.fetch('/assets/a.json');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); resolveNetwork();
  await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(await (await continuing).text(), 'xxx');
});

test('quota failure leaves normal loads usable and never reports a saved map', async () => {
  const f = await fixture();
  f.store.failWrite = new DOMException('Full', 'QuotaExceededError');
  assert.equal(await (await f.cache.fetch('/assets/a.json')).text(), 'xxx');
  assert.equal((await f.cache.status('a')).complete, false);
  assert.ok(f.cache.warnings.some(warning => warning.includes('full')));
  await assert.rejects(f.cache.download('a'), /storage is full/);
  assert.equal(f.store.records.size, 0);
});

test('unavailable IndexedDB falls back to network but explicit downloads report unavailable', async () => {
  const store = new MemoryStore();
  store.setting = async () => { throw new Error('Storage blocked'); };
  const f = await fixture({ store });
  assert.equal(await (await f.cache.fetch('/assets/a.json')).text(), 'xxx');
  await assert.rejects(f.cache.download('a'), /unavailable/);
  assert.equal((await f.cache.status('a')).complete, false);
});

test('cached old revision is never silently substituted when the current revision cannot download', async () => {
  const f = await fixture();
  await f.cache.fetch('/assets/a.json');
  f.setManifest(catalog('a-2'));
  await f.cache.catalog({ refresh: true });
  f.setFailure(async () => { throw new Error('Disconnected'); });
  await assert.rejects(f.cache.fetch('/assets/a.json'), /Disconnected/);
  assert.equal((await f.cache.status('a')).cachedFiles, 0);
});

test('saved catalog supports cached asset reads when server catalog is unavailable, with a warning', async () => {
  const f = await fixture();
  await f.cache.download('a');
  const { AssetCache } = await import('../src/asset-cache.mjs');
  const cache = new AssetCache({ store: f.store, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.equal(await (await cache.fetch('/assets/a.json')).text(), 'xxx');
  assert.equal((await cache.status('a')).complete, true);
  assert.ok(cache.warnings.some(warning => warning.includes('saved asset catalog')));
});

test('HTTP failures and incomplete payloads are never stored as valid assets', async () => {
  const f = await fixture();
  await f.cache.catalog();
  f.setFailure(async () => new Response('Not found', { status: 404 }));
  await assert.rejects(f.cache.fetch('/assets/a.json'), /HTTP 404/);
  f.setFailure(async () => new Response('x'));
  await assert.rejects(f.cache.fetch('/assets/a.json'), /Incomplete asset/);
  assert.equal(f.store.records.size, 0);
});

test('removing a city preserves shared textures, core, and other downloaded cities; clearing only removes asset blobs', async () => {
  const f = await fixture();
  await f.cache.download('a'); await f.cache.download('b');
  await f.cache.remove('a');
  assert.equal(f.store.records.has('/assets/a.json'), false);
  assert.equal(f.store.records.has('/assets/shared.png'), true);
  assert.equal((await f.cache.status('b')).complete, true);
  assert.equal((await f.cache.status('core')).complete, true);
  await f.cache.clear();
  assert.equal(f.store.records.size, 0);
  assert.ok(f.store.settings.get('catalog'), 'catalog retained separately from payloads');
});

test('bounded downloader never exceeds configured active requests', async () => {
  const f = await fixture({ concurrency: 2 });
  await f.cache.catalog();
  let active = 0, peak = 0;
  f.setFailure(async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return new Response('x'.repeat(catalog('a-1').assets.find(asset => asset.url === url).size));
  });
  await Promise.all([f.cache.download('a'), f.cache.download('b')]);
  assert.equal(peak, 2);
});

test('unknown and range requests pass through without polluting asset storage', async () => {
  const f = await fixture();
  await f.cache.fetch('/api/live');
  await f.cache.fetch('/assets/a.json', { headers: { Range: 'bytes=0-1' } });
  assert.equal(f.store.records.size, 0);
});

test('unavailable city pack never appears ready when shared core is already cached', async () => {
  const f = await fixture(), manifest = catalog('a-1');
  manifest.packs.find(pack => pack.id === 'a').assets = [];
  Object.assign(manifest.packs.find(pack => pack.id === 'a'), { available: false, unavailableReason: 'City import is missing' });
  f.setManifest(manifest);
  await f.cache.download('core');
  const status = await f.cache.status('a');
  assert.equal(status.available, false);
  assert.equal(status.complete, false);
  await assert.rejects(f.cache.download('a'), /City import is missing/);
});

test('canceling the only reader aborts transfer and an immediate retry starts a fresh task', async () => {
  const f = await fixture();
  await f.cache.catalog();
  let started, aborted = false;
  const start = new Promise(resolve => { started = resolve; });
  f.setFailure((url, init) => new Promise((resolve, reject) => {
    started();
    init.signal.addEventListener('abort', () => {
      aborted = true;
      // Simulate the browser settling an aborted fetch on its next turn.
      setImmediate(() => reject(new DOMException('Canceled', 'AbortError')));
    });
  }));
  const controller = new AbortController();
  const pending = f.cache.fetch('/assets/a.json', { signal: controller.signal });
  await start;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(aborted, true);
  f.setFailure(async () => new Response('xxx'));
  assert.equal(await (await f.cache.fetch('/assets/a.json')).text(), 'xxx');
});

test('missing shared core prevents a cached city from appearing available or downloadable', async () => {
  const f = await fixture();
  await f.cache.download('a');
  const manifest = catalog('a-1');
  Object.assign(manifest.packs.find(pack => pack.id === 'core'), { available: false, assets: [], unavailableReason: 'Shared character imports are missing' });
  Object.assign(manifest.packs.find(pack => pack.id === 'a'), { available: true });
  f.setManifest(manifest);
  await f.cache.catalog({ refresh: true });
  const status = await f.cache.status('a');
  assert.equal(status.cachedFiles, status.totalFiles, 'city files remain cached');
  assert.equal(status.available, false);
  assert.equal(status.complete, false);
  assert.match(status.unavailableReason, /Shared character imports are missing/);
  const requestCount = f.requests.length;
  await assert.rejects(f.cache.download('a'), /Shared character imports are missing/);
  assert.equal(f.requests.length, requestCount, 'unavailable download must not transfer city files');
});

test('IndexedDB adapter writes and reads metadata plus payload in one transaction, without blobs in metadata scans', async () => {
  const { IndexedDBAssetStore } = await import('../src/asset-cache.mjs');
  const store = new IndexedDBAssetStore(null), db = transactionDatabase();
  store.open = async () => db;
  const record = { url: '/a', revision: '1', size: 3, blob: new Blob(['abc']) };
  await store.put(record);
  assert.deepEqual(db.transactions[0].names, ['metadata', 'blobs']);
  assert.equal(db.transactions[0].mode, 'readwrite');
  assert.equal(db.data.get('metadata').get('/a').blob, undefined);
  assert.equal(await db.data.get('blobs').get('/a').text(), 'abc');
  const loaded = await store.get('/a');
  assert.equal(loaded.revision, '1');
  assert.equal(await loaded.blob.text(), 'abc');
  assert.deepEqual(db.transactions[1].names, ['metadata', 'blobs']);
  assert.deepEqual(await store.metadata(), [{ url: '/a', revision: '1', size: 3 }]);
  assert.deepEqual(db.transactions[2].names, ['metadata']);
  await store.delete(['/a']);
  assert.equal(await store.get('/a'), null);
  assert.equal(db.data.get('blobs').size, 0);
});

test('IndexedDB adapter aborts a failed payload write without committing new metadata', async () => {
  const { IndexedDBAssetStore } = await import('../src/asset-cache.mjs');
  const store = new IndexedDBAssetStore(null), db = transactionDatabase();
  store.open = async () => db;
  await store.put({ url: '/a', revision: 'old', size: 3, blob: new Blob(['old']) });
  db.failStore = 'blobs';
  await assert.rejects(store.put({ url: '/a', revision: 'new', size: 3, blob: new Blob(['new']) }), { name: 'QuotaExceededError' });
  const record = await store.get('/a');
  assert.equal(record.revision, 'old');
  assert.equal(await record.blob.text(), 'old');
  assert.equal(db.data.get('metadata').size, 1);
});
