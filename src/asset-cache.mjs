// Blob storage works on ordinary HTTP LAN addresses; it does not require a
// service worker, HTTPS, or a replacement for the browser's global fetch.
const DB_NAME = 'azeroth-ops-assets';
const abortError = () => new DOMException('Download canceled', 'AbortError');
const checkSignal = signal => { if (signal?.aborted) throw abortError(); };
const errorText = error => error?.message || String(error);

export class IndexedDBAssetStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.opening = null; }
  open() {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      if (!this.indexedDB) return reject(new Error('Browser asset storage is unavailable'));
      const request = this.indexedDB.open(DB_NAME, 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['metadata', 'blobs', 'settings']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      request.onblocked = () => { rejected = true; reject(new Error('Browser asset storage is blocked by another tab')); };
      request.onerror = () => reject(request.error || new Error('Cannot open browser asset storage'));
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.opening = null; };
        resolve(db);
      };
    });
    return this.opening;
  }
  async transaction(names, mode, run) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Browser storage transaction failed'));
      try { run(tx, value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  get(url) {
    return this.transaction(['metadata', 'blobs'], 'readonly', (tx, done) => {
      let metadata, blob, completed = 0;
      const finish = () => { if (++completed === 2) done(metadata && blob ? { ...metadata, blob } : null); };
      const a = tx.objectStore('metadata').get(url), b = tx.objectStore('blobs').get(url);
      a.onsuccess = () => { metadata = a.result; finish(); };
      b.onsuccess = () => { blob = b.result; finish(); };
    });
  }
  metadata() {
    return this.transaction(['metadata'], 'readonly', (tx, done) => {
      const request = tx.objectStore('metadata').getAll();
      request.onsuccess = () => done(request.result);
    });
  }
  put(record) {
    return this.transaction(['metadata', 'blobs'], 'readwrite', tx => {
      const { blob, ...metadata } = record;
      tx.objectStore('metadata').put(metadata, record.url);
      tx.objectStore('blobs').put(blob, record.url);
    });
  }
  delete(urls) {
    return this.transaction(['metadata', 'blobs'], 'readwrite', tx => {
      for (const url of urls) {
        tx.objectStore('metadata').delete(url);
        tx.objectStore('blobs').delete(url);
      }
    });
  }
  clear() {
    return this.transaction(['metadata', 'blobs'], 'readwrite', tx => {
      tx.objectStore('metadata').clear(); tx.objectStore('blobs').clear();
    });
  }
  setting(key, value) {
    const write = arguments.length > 1;
    return this.transaction(['settings'], write ? 'readwrite' : 'readonly', (tx, done) => {
      const request = write ? tx.objectStore('settings').put(value, key) : tx.objectStore('settings').get(key);
      request.onsuccess = () => done(request.result);
    });
  }
}

class NetworkQueue {
  constructor(limit) { this.limit = limit; this.running = 0; this.waiters = []; }
  async run(work, signal) {
    checkSignal(signal);
    if (this.running >= this.limit) {
      await new Promise((resolve, reject) => {
        const waiter = { resolve: () => { cleanup(); resolve(); }, reject };
        const cancel = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          cleanup(); reject(abortError());
        };
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        signal?.addEventListener('abort', cancel, { once: true });
        this.waiters.push(waiter);
      });
    } else this.running++;
    try { checkSignal(signal); return await work(); }
    finally {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve();
      else this.running--;
    }
  }
}

function normalizeURL(input) {
  const raw = typeof input === 'string' ? input : input?.url;
  const base = globalThis.location?.origin || 'http://azeroth.local';
  const url = new URL(raw, base);
  return url.origin === base ? url.pathname + url.search : url.href;
}

function validCatalog(value) {
  if (!value || !Array.isArray(value.assets) || !Array.isArray(value.packs)) throw new Error('Invalid asset download catalog');
  const assets = value.assets.map(asset => {
    if (!asset.url || !asset.revision || !Number.isFinite(asset.size) || asset.size < 0) throw new Error('Invalid asset download entry');
    return { ...asset, url: normalizeURL(asset.url) };
  });
  const known = new Set(assets.map(asset => asset.url));
  const packs = value.packs.map(pack => {
    if (!pack.id || !Array.isArray(pack.assets)) throw new Error('Invalid map download pack');
    const urls = [...new Set(pack.assets.map(normalizeURL))];
    if (urls.some(url => !known.has(url))) throw new Error('Map download references an unknown asset');
    return { ...pack, assets: urls };
  });
  return { ...value, assets, packs };
}

export class AssetCache {
  constructor({ store = new IndexedDBAssetStore(), fetchImpl = globalThis.fetch?.bind(globalThis),
    manifestURL = '/api/assets/manifest', concurrency = 2 } = {}) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.manifestURL = manifestURL;
    this.queue = new NetworkQueue(Math.max(1, Math.min(4, concurrency)));
    this.listeners = new Set();
    this.warningMessages = new Map();
    this.catalogPromise = null;
    this.currentCatalog = null;
    this.assetMap = new Map();
    this.tasks = new Map();
    this.downloads = new Map();
    this.storageAvailable = true;
    this.writesAvailable = true;
    this.generation = 0;
  }
  get warnings() { return [...this.warningMessages.values()]; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) { try { listener(event); } catch { /* UI listeners cannot break a download. */ } } }
  warn(key, message) {
    if (this.warningMessages.get(key) === message) return;
    this.warningMessages.set(key, message); this.emit({ type: 'warning', message, warnings: this.warnings });
  }
  storageFailed(error, write = false) {
    const quota = error?.name === 'QuotaExceededError';
    if (quota || write) this.writesAvailable = false;
    if (!quota) this.storageAvailable = false;
    this.warn('storage', quota
      ? 'Browser storage is full. Free space or remove a map download; assets will still load from the server.'
      : `Browser downloads are unavailable: ${errorText(error)}. Assets will still load from the server.`);
  }
  async catalog({ refresh = false } = {}) {
    if (this.catalogPromise && !refresh) return this.catalogPromise;
    const request = async () => {
      let value;
      try {
        const response = await this.fetchImpl(this.manifestURL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
        value = validCatalog(await response.json());
        this.warningMessages.delete('catalog');
        if (this.storageAvailable) {
          try { await this.store.setting('catalog', value); }
          catch (error) { this.storageFailed(error, true); }
        }
      } catch (error) {
        if (this.storageAvailable) {
          try { value = validCatalog(await this.store.setting('catalog')); }
          catch (storageError) { if (!String(storageError?.message).includes('Invalid asset download catalog')) this.storageFailed(storageError); }
        }
        if (!value) throw error;
        this.warn('catalog', 'Using the saved asset catalog because the server could not be reached. Connect to the server to check for map updates.');
      }
      this.currentCatalog = value;
      this.assetMap = new Map(value.assets.map(asset => [asset.url, asset]));
      return value;
    };
    this.catalogPromise = request().catch(error => { this.catalogPromise = null; throw error; });
    return this.catalogPromise;
  }
  async prepare() { return this.catalog(); }
  packAssets(packId) {
    const pack = this.currentCatalog.packs.find(pack => pack.id === packId);
    if (!pack) throw new Error(`Unknown map download: ${packId}`);
    const core = this.currentCatalog.packs.find(pack => pack.id === 'core');
    const urls = [...new Set([...(core?.assets || []), ...pack.assets])];
    const unavailable = [...new Set([core, pack])].filter(dependency => dependency?.available === false);
    const unavailableReason = unavailable.map(dependency => dependency.unavailableReason || `${dependency.name || dependency.id} is not installed on the host`).join(' ');
    return { pack, assets: urls.map(url => this.assetMap.get(url)), available: unavailable.length === 0, unavailableReason };
  }
  matches(record, asset) { return !!record && record.revision === asset.revision && record.size === asset.size; }
  async metadata() {
    if (!this.storageAvailable) return new Map();
    try { return new Map((await this.store.metadata()).map(record => [record.url, record])); }
    catch (error) { this.storageFailed(error); return new Map(); }
  }
  statusFrom(packId, metadata) {
    const { pack, assets, available, unavailableReason } = this.packAssets(packId);
    const cached = assets.filter(asset => this.matches(metadata.get(asset.url), asset));
    return { id: pack.id, name: pack.name || pack.id, available, unavailableReason, totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
      cachedBytes: cached.reduce((sum, asset) => sum + asset.size, 0), totalFiles: assets.length, cachedFiles: cached.length,
      complete: available && cached.length === assets.length && this.storageAvailable,
      downloading: this.downloads.has(packId), warning: this.warnings.join(' '), warnings: this.warnings };
  }
  async status(packId) { await this.catalog(); return this.statusFrom(packId, await this.metadata()); }
  async statuses() {
    const catalog = await this.catalog(), metadata = await this.metadata();
    return catalog.packs.map(pack => this.statusFrom(pack.id, metadata));
  }
  async joinTask(task, signal) {
    checkSignal(signal);
    task.users++;
    let cancel;
    try {
      if (!signal) return await task.promise;
      return await Promise.race([task.promise, new Promise((resolve, reject) => {
        cancel = () => reject(abortError());
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      })]);
    } finally {
      signal?.removeEventListener('abort', cancel);
      task.users--;
      if (!task.users && !task.settled) task.controller.abort();
    }
  }
  load(asset, options = {}) {
    checkSignal(options.signal);
    const key = `${asset.url}\n${asset.revision}`;
    let task = this.tasks.get(key);
    // A canceled last reader can be followed immediately by a new load before
    // fetch has finished rejecting. Do not attach that load to the dead task.
    if (task?.controller.signal.aborted) task = null;
    if (!task) {
      const controller = new AbortController(), generation = this.generation;
      task = { controller, users: 0, settled: false };
      task.promise = Promise.resolve().then(async () => {
        if (this.storageAvailable) {
          try {
            const record = await this.store.get(asset.url);
            if (this.matches(record, asset) && record.blob?.size === asset.size) return { blob: record.blob, stored: true, cached: true };
          } catch (error) { this.storageFailed(error); }
        }
        return this.queue.run(async () => {
          // A previous server build may have given this URL a long HTTP cache
          // lifetime. Always revalidate before attaching the new revision.
          const response = await this.fetchImpl(asset.url, { ...options, cache: 'no-cache', signal: controller.signal });
          if (!response.ok || response.status !== 200) throw new Error(`Could not download ${asset.url}: HTTP ${response.status}`);
          const blob = await response.blob();
          checkSignal(controller.signal);
          if (blob.size !== asset.size) throw new Error(`Incomplete asset download: ${asset.url}`);
          let stored = false;
          if (this.storageAvailable && this.writesAvailable && generation === this.generation) {
            try {
              await this.store.put({ url: asset.url, revision: asset.revision, size: blob.size, type: asset.type || blob.type, blob });
              stored = true;
              this.emit({ type: 'cached', url: asset.url, bytes: blob.size });
            } catch (error) { this.storageFailed(error, true); }
          }
          return { blob, stored, cached: false };
        }, controller.signal);
      }).finally(() => {
        task.settled = true;
        if (this.tasks.get(key) === task) this.tasks.delete(key);
      });
      this.tasks.set(key, task);
    }
    return this.joinTask(task, options.signal);
  }
  async fetch(input, options = {}) {
    const url = normalizeURL(input);
    if ((options.method && options.method.toUpperCase() !== 'GET') || new Headers(options.headers).has('range')) return this.fetchImpl(input, options);
    try { await this.catalog(); }
    catch (error) {
      this.warn('catalog', `Asset downloads are unavailable: ${errorText(error)}. Loading directly from the server.`);
      return this.fetchImpl(input, options);
    }
    const asset = this.assetMap.get(url);
    if (!asset) return this.fetchImpl(input, options);
    const { blob } = await this.load(asset, options);
    return new Response(blob, { status: 200, headers: { 'Content-Type': asset.type || blob.type || 'application/octet-stream', 'Content-Length': String(blob.size) } });
  }
  async download(packId, { signal, onProgress } = {}) {
    checkSignal(signal);
    if (this.downloads.has(packId)) throw new Error('This map is already downloading');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.downloads.set(packId, controller);
    try {
      await this.catalog(); checkSignal(signal); checkSignal(controller.signal);
      const { assets, available, unavailableReason } = this.packAssets(packId);
      if (!available) throw new Error(unavailableReason || 'This map is not installed on the host');
      const metadata = await this.metadata();
      const progress = () => {
        const state = this.statusFrom(packId, metadata);
        onProgress?.(state); this.emit({ type: 'progress', ...state });
      };
      progress();
      if (!this.storageAvailable || !this.writesAvailable) throw new Error(this.warnings.join(' ') || 'Browser asset storage is unavailable');
      const pending = assets.filter(asset => !this.matches(metadata.get(asset.url), asset));
      let index = 0;
      const workers = Array.from({ length: Math.min(this.queue.limit, pending.length) }, async () => {
        while (index < pending.length) {
          checkSignal(controller.signal);
          const asset = pending[index++];
          const result = await this.load(asset, { signal: controller.signal });
          if (!result.stored) throw new Error(this.warnings.join(' ') || 'This asset could not be saved in the browser');
          metadata.set(asset.url, asset); progress();
        }
      });
      // Stop sibling workers on failure, then wait until they have all released
      // their requests before exposing the error to the UI.
      let firstError;
      await Promise.all(workers.map(worker => worker.catch(error => { firstError ||= error; controller.abort(); })));
      if (firstError) throw firstError;
      checkSignal(controller.signal);
      return { ...this.statusFrom(packId, metadata), downloading: false };
    } finally {
      this.downloads.delete(packId);
      signal?.removeEventListener('abort', cancel);
      this.emit({ type: 'download-end', id: packId });
    }
  }
  async settleWrites() {
    // Existing network reads may finish, but their old generation cannot write
    // after removal. Wait for transactions already underway before deleting.
    this.generation++;
    for (const download of this.downloads.values()) download.abort();
    await Promise.allSettled([...this.tasks.values()].map(task => task.promise));
  }
  async remove(packId) {
    await this.catalog();
    const target = this.currentCatalog.packs.find(pack => pack.id === packId);
    if (!target) throw new Error(`Unknown map download: ${packId}`);
    await this.settleWrites();
    // Shared character/weapon files and shared city textures remain available
    // to other packs. Clear all downloads is the explicit way to remove these.
    const protectedURLs = new Set(this.currentCatalog.packs.filter(pack => pack.id !== packId).flatMap(pack => pack.assets));
    if (packId !== 'core') for (const url of this.currentCatalog.packs.find(pack => pack.id === 'core')?.assets || []) protectedURLs.add(url);
    await this.store.delete(target.assets.filter(url => !protectedURLs.has(url)));
    this.storageAvailable = this.writesAvailable = true; this.warningMessages.delete('storage');
    this.emit({ type: 'removed', id: packId });
    return this.status(packId);
  }
  async clear() {
    await this.settleWrites(); await this.store.clear();
    this.storageAvailable = this.writesAvailable = true; this.warningMessages.delete('storage');
    this.emit({ type: 'cleared' });
  }
}

export const assetCache = new AssetCache();
export const assetFetch = (url, options) => assetCache.fetch(url, options);
export const prepareAssetCache = options => assetCache.catalog(options);
