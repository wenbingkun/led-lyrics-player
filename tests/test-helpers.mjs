import path from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cache = new Map();

async function loadModule(filePath) {
  const absolutePath = path.resolve(filePath);
  if (cache.has(absolutePath)) {
    return cache.get(absolutePath);
  }

  const code = await readFile(absolutePath, 'utf8');
  const module = new vm.SourceTextModule(code, {
    identifier: pathToFileURL(absolutePath).href
  });

  cache.set(absolutePath, module);

  await module.link(async (specifier, referencingModule) => {
    const resolvedUrl = new URL(specifier, referencingModule.identifier);
    if (resolvedUrl.protocol !== 'file:') {
      throw new Error(`Unsupported import protocol: ${resolvedUrl.protocol}`);
    }
    return loadModule(fileURLToPath(resolvedUrl));
  });

  await module.evaluate();
  return module;
}

export let failures = 0;

export function resetPlayer() {
  for (const key of Object.keys(player)) {
    delete player[key];
  }

  installDocumentStub({ notificationContainer: createElement() });
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  }
  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  if (!globalThis.performance) {
    globalThis.performance = { now: () => Date.now() };
  }

  player.songs = [];
  player.currentSongIndex = -1;
  player.currentLyricIndex = -1;
  player.isPlaying = false;
  player.currentTime = 0;
  player.playbackSpeed = 1;
  player.animationId = null;
  player.startTime = null;
  player.pausedTime = 0;
  player.lastProgressUpdate = 0;
  player.lastLyricsUpdate = 0;
  player.lastLyricSearchIndex = 0;
  player.lastLyricSearchTime = 0;
  player.lyricsCache = new Map();

  player.audioElement = null;
  player.audioMode = false;
  player.audioOffset = 0;
  player.fontScale = 1.3;
  player.currentTheme = 'classic';
  player.searchResults = [];
  player.objectUrls = new Set();
  player.eventListeners = new Map();
  player.eventListenerRegistry = new Map();
  player.timers = new Set();
  player.cursorTimeout = null;

  player.playMode = 'loop';
  player.playHistory = [];

  player.wakeLock = null;
  player.wakeLockSupported = false;

  player.draggedElement = null;
}

export async function test(name, fn) {
  try {
    resetPlayer();
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

export function finalize() {
  if (failures > 0) {
    process.exitCode = 1;
  }
}

export function createElement() {
  const element = {
    _innerHTML: '',
    textContent: '',
    children: [],
    style: { display: '', width: '' },
    className: '',
    classList: {
      add() {},
      remove() {},
      contains() { return false; }
    },
    focus() {
      this._focused = true;
    },
    addEventListener(type, handler) {
      if (!this._listeners) {
        this._listeners = new Map();
      }
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push(handler);
    },
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) {
        this.children.splice(index, 1);
      }
    },
    querySelectorAll() { return []; }
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = String(value);
      this.children = [];
    }
  });

  return element;
}

export function installDocumentStub(stubbedElements) {
  const elements = { notificationContainer: createElement(), ...stubbedElements };
  globalThis.document = {
    _listeners: new Map(),
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(elements, id)
        ? elements[id]
        : null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createElement();
    },
    addEventListener(type, handler) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push(handler);
    },
    body: createElement()
  };
}

export function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export const utilsModule = await loadModule(path.resolve('js/utils.js'));
export const playerModule = await loadModule(path.resolve('js/player.js'));

export const { escapeHtml, highlightText, formatTime } = utilsModule.namespace;
export const { LEDLyricsPlayer } = playerModule.namespace;

export const player = Object.create(LEDLyricsPlayer.prototype);
