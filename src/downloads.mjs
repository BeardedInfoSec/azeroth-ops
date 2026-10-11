import {assetCache} from './asset-cache.mjs';

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

// Kept separate from the renderer: opening and managing downloads never needs
// a loaded city, pointer lock, a match, or a WebGL context.
export class DownloadsView {
  constructor({cache = assetCache, document = globalThis.document} = {}) {
    this.cache = cache;
    this.document = document;
    this.dialog = document.getElementById('downloads');
    this.list = document.getElementById('download-packs');
    this.message = document.getElementById('download-message');
    this.warning = document.getElementById('download-warning');
    this.refreshButton = document.getElementById('download-refresh');
    this.clearButton = document.getElementById('download-clear');
    this.rows = new Map();
    this.states = [];
    this.job = null;
    this.busy = false;
    this.readSequence = 0;
    this.timer = null;
    for (const button of document.querySelectorAll('[data-downloads-open]')) {
      button.addEventListener('click', () => this.open());
    }
    document.getElementById('downloads-close').addEventListener('click', () => this.dialog.close());
    this.refreshButton.addEventListener('click', () => this.refresh(true));
    this.clearButton.addEventListener('click', () => this.remove());
    this.unsubscribe = cache.subscribe(event => {
      if (event.type === 'warning') this.renderWarnings();
      if (this.dialog.open && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.sync().catch(error => this.report(error.message, true)); }, 400);
      }
    });
    this.render();
  }
  async open() {
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.job && !this.busy) await this.refresh();
    else await this.sync().catch(error => this.report(error.message, true));
  }
  report(text, error = false) {
    this.message.textContent = text;
    this.message.dataset.error = String(error);
  }
  renderWarnings() {
    this.warning.textContent = this.cache.warnings.join(' ');
    this.warning.hidden = !this.warning.textContent;
  }
  async sync() {
    const sequence = ++this.readSequence;
    const states = await this.cache.statuses();
    if (sequence !== this.readSequence) return;
    this.states = states;
    this.render();
  }
  async refresh(check = false) {
    if (this.busy || this.job) return;
    this.busy = true;
    this.render();
    this.report(check ? 'Checking for updated map files...' : 'Checking your saved maps...');
    try {
      await this.cache.catalog({refresh: check});
      await this.sync();
      this.report('Cities include shared weapons, operators and audio. Shared files are saved once.');
    } catch (error) {
      this.report(`Could not check downloads: ${error.message}. Use Check for updates to retry.`, true);
    } finally { this.busy = false; this.render(); }
  }
  makeRow(state) {
    const make = (tag, className, text) => {
      const node = this.document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const card = make('article', 'download-card');
    card.dataset.pack = state.id;
    const eyebrow = make('small', 'download-category', state.id === 'core' ? 'USED BY EVERY CITY' : 'BATTLEFIELD + SHARED FILES');
    const name = make('h3', 'download-name', state.name);
    const status = make('span', 'download-state');
    const size = make('p', 'download-size');
    const progress = make('progress', 'download-progress');
    progress.setAttribute('aria-label', `${state.name} download progress`);
    const detail = make('p', 'download-detail');
    const actions = make('div', 'download-actions');
    const download = make('button', 'download-primary', 'DOWNLOAD');
    download.type = 'button';
    download.addEventListener('click', () => {
      if (this.job?.id === state.id) this.job.controller.abort();
      else this.download(state.id);
    });
    const remove = make('button', 'download-remove', 'REMOVE');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${state.name} downloaded files`);
    remove.addEventListener('click', () => this.remove(state.id));
    actions.append(download, remove);
    card.append(eyebrow, name, status, size, progress, detail, actions);
    this.list.append(card);
    const row = {card, name, status, size, progress, detail, download, remove};
    this.rows.set(state.id, row);
    return row;
  }
  render() {
    const ids = new Set(this.states.map(state => state.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.card.remove(); this.rows.delete(id); }
    for (const state of this.states) {
      const row = this.rows.get(state.id) || this.makeRow(state);
      const downloading = this.job?.id === state.id;
      const unavailable = state.available === false;
      row.name.textContent = state.name;
      row.card.dataset.complete = String(state.complete);
      row.status.textContent = unavailable ? 'NOT INSTALLED ON HOST' : downloading ? 'DOWNLOADING' : state.complete ? 'SAVED IN THIS BROWSER' : state.cachedFiles ? 'PARTIALLY SAVED' : 'NOT DOWNLOADED';
      row.size.textContent = `${formatBytes(state.cachedBytes)} / ${formatBytes(state.totalBytes)} saved`;
      row.progress.max = Math.max(1, state.totalBytes);
      row.progress.value = state.cachedBytes;
      row.detail.textContent = unavailable ? state.unavailableReason || 'Ask the host to import this city.' : `${state.cachedFiles} / ${state.totalFiles} files${state.complete ? ' · Ready for your next visit' : ' · ' + formatBytes(state.totalBytes - state.cachedBytes) + ' remaining'}`;
      row.download.textContent = downloading ? 'CANCEL' : state.complete ? 'DOWNLOADED' : state.cachedFiles ? 'RESUME DOWNLOAD' : 'DOWNLOAD';
      row.download.setAttribute('aria-label', `${downloading ? 'Cancel' : state.complete ? 'Downloaded' : 'Download'} ${state.name}`);
      row.download.disabled = this.busy || unavailable || (!downloading && (!!this.job || state.complete));
      row.remove.disabled = this.busy || !!this.job || !state.cachedFiles;
      // Core is a dependency of all cities. Removing it separately is misleading;
      // the explicit all-downloads action removes the shared files too.
      row.remove.hidden = state.id === 'core';
    }
    this.refreshButton.disabled = this.busy || !!this.job;
    this.clearButton.disabled = this.busy || !!this.job || !this.states.some(state => state.cachedFiles);
    this.renderWarnings();
  }
  async download(id) {
    if (this.busy || this.job) return;
    const controller = new AbortController();
    this.job = {id, controller};
    this.render();
    this.report('Downloading to this browser. You can close this panel; keep this tab open.');
    try {
      const result = await this.cache.download(id, {signal: controller.signal, onProgress: state => {
        const index = this.states.findIndex(item => item.id === id);
        if (index >= 0) this.states[index] = state;
        this.render();
      }});
      this.report(result.complete ? `${result.name} is saved in this browser.` : 'Some files could not be saved. Resume to try again.', !result.complete);
    } catch (error) {
      this.report(error.name === 'AbortError' ? 'Download canceled. Saved files are kept; resume whenever you are ready.' : `Download stopped: ${error.message}`, error.name !== 'AbortError');
    } finally {
      this.job = null;
      await this.sync().catch(error => this.report(error.message, true));
      this.render();
    }
  }
  async remove(id) {
    if (this.busy || this.job) return;
    this.busy = true; this.render();
    this.report('Removing downloaded files...');
    try {
      if (id) await this.cache.remove(id);
      else await this.cache.clear();
      await this.sync();
      this.report(id ? 'City files removed. Files shared with other cities are kept.' : 'All downloaded game files removed. Your saved classes are unchanged.');
    } catch (error) { this.report(`Could not remove files: ${error.message}`, true); }
    finally { this.busy = false; this.render(); }
  }
  dispose() { clearTimeout(this.timer); this.unsubscribe(); }
}
