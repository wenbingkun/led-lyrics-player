import assert from 'node:assert/strict';
import {
  test,
  player,
  LEDLyricsPlayer,
  createElement,
  installDocumentStub,
  flushPromises
} from './test-helpers.mjs';

await test('parseLrc parses and sorts valid lines', () => {
  const lrc = [
    '[00:01.00]first',
    '[00:00.50]start',
    '[00:02]second',
    '[00:bad]ignored',
    '[00:03.1]third'
  ].join('\n');

  const parsed = player.parseLrc(lrc);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].text, 'start');
  assert.equal(parsed[0].time, 0.5);
  assert.equal(parsed[1].text, 'first');
  assert.equal(parsed[1].time, 1);
  assert.equal(parsed[2].text, 'second');
  assert.equal(parsed[2].time, 2);
  assert.equal(parsed[3].text, 'third');
  assert.equal(parsed[3].time, 3.1);
});

await test('parseLrc throws on invalid input', () => {
  assert.throws(() => player.parseLrc(null), /无效的歌词文件内容/);
  assert.throws(() => player.parseLrc(123), /无效的歌词文件内容/);
});

await test('parseLrc fills empty lyric text with placeholder', () => {
  const lrc = '[00:00.00]   \n[00:01.00]next';
  const parsed = player.parseLrc(lrc);
  assert.equal(parsed[0].text, '♪');
  assert.equal(parsed[1].text, 'next');
});

await test('parseLrc merges duplicate timestamps', () => {
  const lrc = [
    '[00:01.00]first',
    '[00:01.00]second',
    '[00:02.00]third'
  ].join('\n');

  const parsed = player.parseLrc(lrc);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].time, 1);
  assert.equal(parsed[0].text, 'first / second');
  assert.equal(parsed[1].text, 'third');
});

await test('parseLrc applies offset metadata', () => {
  const lrc = [
    '[offset:1000]',
    '[00:01.00]first',
    '[00:02.00]second'
  ].join('\n');

  const parsed = player.parseLrc(lrc);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].time, 2);
  assert.equal(parsed[1].time, 3);
});

await test('normalizeForMatching strips prefixes and separators', () => {
  const normalized = player.normalizeForMatching('01_HeLLo-World.mp3');
  assert.equal(normalized, 'helloworld');
});

await test('formatSongNameForDisplay removes prefixes and extensions', () => {
  const display = player.formatSongNameForDisplay('002_Intro-Track.lrc');
  assert.equal(display, 'Intro-Track');
});

await test('calculateMatchScore returns perfect score for exact match', () => {
  const score = player.calculateMatchScore('Track01', 'Track01');
  assert.equal(score, 1);
});

await test('calculateMatchScore favors normalized match', () => {
  const score = player.calculateMatchScore('01-My_Song', 'my song');
  assert.ok(score >= 0.9);
});

await test('calculateSimilarity and levenshteinDistance behave consistently', () => {
  assert.equal(player.levenshteinDistance('kitten', 'sitting'), 3);
  const similarity = player.calculateSimilarity('kitten', 'sitting');
  assert.ok(similarity > 0.5 && similarity < 1);
});

await test('findBestMatch returns highest score candidate', () => {
  player.songs = [
    { name: '01-hello-world' },
    { name: 'goodbye' },
    { name: 'hello world remix' }
  ];

  const matched = player.findBestMatch('hello_world');
  assert.ok(matched);
  assert.equal(matched.name, '01-hello-world');
});

await test('findBestMatch returns null when no candidates meet threshold', () => {
  player.songs = [
    { name: 'alpha' },
    { name: 'beta' },
    { name: 'gamma' }
  ];

  const matched = player.findBestMatch('zzzzzz');
  assert.equal(matched, null);
});

await test('getAvailableModes enables audio/sync when audioFile is present', () => {
  const lyricsOnly = { lyrics: [{ time: 0, text: 'a' }] };
  const withAudioFile = { lyrics: [{ time: 0, text: 'a' }], audioFile: {}, audioElement: null };
  const withAudioElement = { lyrics: [{ time: 0, text: 'a' }], audioFile: {}, audioElement: {} };

  assert.equal(Object.prototype.audioElement, undefined);
  assert.equal(withAudioFile.audioElement, null);

  assert.deepEqual(player.getAvailableModes(lyricsOnly), ['lyrics']);
  assert.deepEqual(player.getAvailableModes(withAudioFile), ['lyrics', 'audio', 'sync']);
  assert.deepEqual(player.getAvailableModes(withAudioElement), ['lyrics', 'audio', 'sync']);
});

await test('getEffectiveMode falls back when user mode unavailable', () => {
  const song = { userMode: 'sync', lyrics: [{ time: 0, text: 'a' }] };
  const mode = player.getEffectiveMode(song);
  assert.equal(mode, 'lyrics');
});

await test('getEffectiveMode respects user choice when available', () => {
  const song = {
    userMode: 'audio',
    lyrics: [{ time: 0, text: 'a' }],
    audioFile: {},
    audioElement: {}
  };
  const mode = player.getEffectiveMode(song);
  assert.equal(mode, 'audio');
});

await test('getAutoDetectedMode prefers sync when both available', () => {
  const song = { lyrics: [{ time: 0, text: 'a' }], audioFile: {} };
  assert.equal(player.getAutoDetectedMode(song), 'sync');
});

await test('getNextSongIndex works across play modes', () => {
  player.songs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  player.currentSongIndex = 1;

  player.playMode = 'list';
  assert.equal(player.getNextSongIndex(), 2);

  player.playMode = 'loop';
  assert.equal(player.getNextSongIndex(), 2);
  player.currentSongIndex = 2;
  assert.equal(player.getNextSongIndex(), 0);

  player.playMode = 'single';
  assert.equal(player.getNextSongIndex(), 2);

  player.playMode = 'random';
  player.playHistory = [];
  const nextIndex = player.getNextSongIndex();
  assert.ok(nextIndex >= 0 && nextIndex < player.songs.length);
});

await test('loadLrcFiles waits for all reads before sorting', async () => {
  const originalFileReader = globalThis.FileReader;
  let sortCalls = 0;
  let updateCalls = 0;
  let notifyCalls = 0;

  globalThis.FileReader = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText(file) {
      if (file.shouldError) {
        if (this.onerror) {
          this.onerror(new Error('read error'));
        }
        return;
      }
      if (this.onload) {
        this.onload({ target: { result: file.content } });
      }
    }
  };

  try {
    player.songs = [];
    player.addSong = (song) => {
      player.songs.push(song);
    };
    player.sortPlaylist = () => { sortCalls += 1; };
    player.updatePlaylist = () => { updateCalls += 1; };
    player.showNotification = () => { notifyCalls += 1; };

    const files = [
      { name: '01-first.lrc', content: '[00:00.00]first' },
      { name: '02-second.txt', content: '[00:00.00]second' },
      { name: 'ignore.mp3', content: '' }
    ];

    player.loadLrcFiles(files);
    await flushPromises();

    assert.equal(player.songs.length, 2);
    assert.equal(sortCalls, 1);
    assert.equal(updateCalls, 1);
    assert.equal(notifyCalls, 3);
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

await test('loadLrcFiles still sorts when a read fails', async () => {
  const originalFileReader = globalThis.FileReader;
  const originalConsoleError = console.error;
  let sortCalls = 0;
  let updateCalls = 0;

  globalThis.FileReader = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText(file) {
      if (file.shouldError) {
        if (this.onerror) {
          this.onerror(new Error('read error'));
        }
        return;
      }
      if (this.onload) {
        this.onload({ target: { result: file.content } });
      }
    }
  };

  try {
    console.error = () => {};
    player.songs = [];
    player.addSong = (song) => {
      player.songs.push(song);
    };
    player.sortPlaylist = () => { sortCalls += 1; };
    player.updatePlaylist = () => { updateCalls += 1; };
    player.showNotification = () => {};

    const files = [
      { name: '01-first.lrc', content: '[00:00.00]first' },
      { name: 'bad.lrc', shouldError: true }
    ];

    player.loadLrcFiles(files);
    await flushPromises();

    assert.equal(player.songs.length, 1);
    assert.equal(sortCalls, 1);
    assert.equal(updateCalls, 1);
  } finally {
    console.error = originalConsoleError;
    globalThis.FileReader = originalFileReader;
  }
});

await test('loadAudioFiles associates audio and updates duration', async () => {
  const originalAudio = globalThis.Audio;
  const originalURL = globalThis.URL;
  const originalSetTimeout = globalThis.setTimeout;

  let updateCalls = 0;
  let sortCalls = 0;
  let reportCalls = 0;
  const notifications = [];
  const createdUrls = [];
  const revokedUrls = [];

  globalThis.URL = {
    createObjectURL(file) {
      const url = `blob:${file.name}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revokedUrls.push(url);
    }
  };

  globalThis.Audio = class {
    constructor() {
      this._listeners = new Map();
      this.duration = 123;
      this._src = '';
      this._metadataFired = false;
    }

    addEventListener(type, handler, options = {}) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push({ handler, once: Boolean(options.once) });
    }

    set src(value) {
      this._src = value;
      if (!value || this._metadataFired) {
        return;
      }
      const handlers = this._listeners.get('loadedmetadata') || [];
      this._metadataFired = true;
      handlers.slice().forEach(entry => {
        entry.handler();
        if (entry.once) {
          const list = this._listeners.get('loadedmetadata') || [];
          const index = list.indexOf(entry);
          if (index >= 0) {
            list.splice(index, 1);
          }
        }
      });
    }

    get src() {
      return this._src;
    }
  };

  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  try {
    player.songs = [{ name: 'match-me', lyrics: [{ time: 0, text: 'a' }], duration: 0 }];
    player.timers = new Set();
    player.updatePlaylist = () => { updateCalls += 1; };
    player.sortPlaylist = () => { sortCalls += 1; };
    player.showMatchingReport = () => { reportCalls += 1; };
    player.showNotification = (message, type) => { notifications.push({ message, type }); };

    const files = [{ name: 'match-me.mp3' }];
    player.loadAudioFiles(files);
    await flushPromises();

    assert.equal(player.songs[0].audioFile, files[0]);
    assert.equal(player.songs[0].duration, 123);
    assert.equal(updateCalls, 2);
    assert.equal(sortCalls, 1);
    assert.equal(reportCalls, 1);
    assert.equal(notifications.length, 1);
    assert.equal(createdUrls.length, 1);
    assert.equal(revokedUrls.length, 1);
  } finally {
    globalThis.Audio = originalAudio;
    globalThis.URL = originalURL;
    globalThis.setTimeout = originalSetTimeout;
  }
});

await test('loadAudioFiles notifies when no match is found', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const notifications = [];

  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  try {
    player.songs = [];
    player.timers = new Set();
    player.showNotification = (message, type) => { notifications.push({ message, type }); };
    player.sortPlaylist = () => {};
    player.updatePlaylist = () => {};
    player.showMatchingReport = () => {};

    const files = [{ name: 'lonely.mp3' }];
    player.loadAudioFiles(files);
    await flushPromises();

    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].type, 'warning');
    assert.equal(notifications[1].type, 'info');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

await test('importPlaylist filters invalid songs and lyrics', async () => {
  const originalFileReader = globalThis.FileReader;
  const notifications = [];
  const added = [];

  globalThis.FileReader = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText() {
      const payload = JSON.stringify({
        songs: [
          { name: 'valid', lyrics: [{ time: 1, text: 'ok' }, { time: 'bad', text: 'no' }], duration: 12, userMode: 'sync' },
          { name: 'invalid-lyrics', lyrics: [], duration: 1 },
          { name: '', lyrics: [{ time: 1, text: 'x' }] }
        ]
      });
      this.onload({ target: { result: payload } });
    }
  };

  try {
    player.clearPlaylist = () => {};
    player.addSong = (song) => { added.push(song); };
    player.showNotification = (message, type) => { notifications.push({ message, type }); };

    player.importPlaylist({});

    assert.equal(added.length, 1);
    assert.equal(added[0].name, 'valid');
    assert.equal(added[0].lyrics.length, 1);
    assert.equal(added[0].duration, 12);
    assert.equal(added[0].userMode, 'sync');
    assert.equal(notifications.at(-1).type, 'success');
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

await test('importPlaylist rejects empty or invalid playlists', async () => {
  const originalFileReader = globalThis.FileReader;
  const originalConsoleError = console.error;
  const notifications = [];

  globalThis.FileReader = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText() {
      const payload = JSON.stringify({ songs: [{ name: 'bad', lyrics: [] }] });
      this.onload({ target: { result: payload } });
    }
  };

  try {
    console.error = () => {};
    player.clearPlaylist = () => {};
    player.addSong = () => {};
    player.showNotification = (message, type) => { notifications.push({ message, type }); };

    player.importPlaylist({});

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'error');
  } finally {
    console.error = originalConsoleError;
    globalThis.FileReader = originalFileReader;
  }
});

await test('importPlaylist warns on unsupported version and sorts lyrics', async () => {
  const originalFileReader = globalThis.FileReader;
  const notifications = [];
  const added = [];

  globalThis.FileReader = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText() {
      const payload = JSON.stringify({
        version: '2.0',
        songs: [
          {
            name: 'sorted',
            lyrics: [
              { time: 3, text: 'c' },
              { time: 1, text: 'a' },
              { time: -1, text: 'skip' },
              { time: 2, text: 'b' }
            ],
            duration: 5,
            userMode: 'lyrics'
          }
        ]
      });
      this.onload({ target: { result: payload } });
    }
  };

  try {
    player.clearPlaylist = () => {};
    player.addSong = (song) => { added.push(song); };
    player.showNotification = (message, type) => { notifications.push({ message, type }); };

    player.importPlaylist({});

    assert.equal(notifications[0].type, 'warning');
    assert.equal(added.length, 1);
    assert.deepEqual(added[0].lyrics.map(line => line.text), ['a', 'b', 'c']);
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

await test('exportPlaylist emits sanitized payload', () => {
  const originalBlob = globalThis.Blob;
  const originalURL = globalThis.URL;
  const originalDate = globalThis.Date;
  const originalDocument = globalThis.document;

  let blobData = '';
  const createdUrls = [];

  globalThis.Blob = class {
    constructor(parts) {
      blobData = parts.join('');
    }
  };
  globalThis.URL = {
    createObjectURL() {
      const url = 'blob:export';
      createdUrls.push(url);
      return url;
    }
  };
  globalThis.Date = class extends Date {
    toISOString() {
      return '2024-01-01T00:00:00.000Z';
    }
  };
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      return { click() {}, set href(_) {}, set download(_) {} };
    }
  };

  try {
    player.objectUrls = new Set();
    player.showNotification = () => {};
    player.songs = [{
      name: 'song',
      lyrics: [{ time: 1, text: 'a' }, { time: 'bad', text: 2 }],
      duration: -5,
      userMode: 'sync'
    }];

    player.exportPlaylist();

    const parsed = JSON.parse(blobData);
    assert.equal(parsed.songs.length, 1);
    assert.equal(parsed.songs[0].lyrics.length, 1);
    assert.equal(parsed.songs[0].duration, 0);
    assert.equal(parsed.songs[0].userMode, 'sync');
    assert.equal(createdUrls.length, 1);
  } finally {
    globalThis.Blob = originalBlob;
    globalThis.URL = originalURL;
    globalThis.Date = originalDate;
    globalThis.document = originalDocument;
  }
});

await test('processFolderFiles filters lyrics files and calls loadLrcFiles', async () => {
  const notifications = [];
  let receivedFiles = null;

  player.showNotification = (message, type) => { notifications.push({ message, type }); };
  player.loadLrcFiles = (files) => { receivedFiles = files; };
  player.sortPlaylist = () => {};
  player.updatePlaylist = () => {};

  const files = [
    { name: '01-hello.lrc', webkitRelativePath: 'a/01-hello.lrc' },
    { name: '02-world.txt', webkitRelativePath: 'b/02-world.txt' },
    { name: '03-skip.mp3', webkitRelativePath: 'b/03-skip.mp3' }
  ];

  player.processFolderFiles(files, 'lyrics');

  assert.ok(receivedFiles);
  assert.equal(receivedFiles.length, 2);
  assert.equal(notifications[0].type, 'info');
  assert.equal(notifications[1].type, 'success');
});

await test('processFolderFiles filters audio files and triggers report', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const notifications = [];
  let receivedFiles = null;
  let reportCalls = 0;
  let sortCalls = 0;
  let updateCalls = 0;

  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  try {
    player.timers = new Set();
    player.showNotification = (message, type) => { notifications.push({ message, type }); };
    player.loadAudioFiles = (files) => { receivedFiles = files; };
    player.showMatchingReport = () => { reportCalls += 1; };
    player.sortPlaylist = () => { sortCalls += 1; };
    player.updatePlaylist = () => { updateCalls += 1; };

    const files = [
      { name: '01-hello.mp3', webkitRelativePath: 'a/01-hello.mp3' },
      { name: '02-world.flac', webkitRelativePath: 'b/02-world.flac' },
      { name: '03-skip.txt', webkitRelativePath: 'b/03-skip.txt' }
    ];

    player.processFolderFiles(files, 'audio');
    await flushPromises();

    assert.ok(receivedFiles);
    assert.equal(receivedFiles.length, 2);
    assert.equal(reportCalls, 1);
    assert.equal(sortCalls, 1);
    assert.equal(updateCalls, 1);
    assert.equal(notifications[0].type, 'info');
    assert.equal(notifications[1].type, 'success');
    assert.equal(notifications[2].type, 'success');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

await test('processFolderFiles warns on empty folder', () => {
  const notifications = [];
  player.showNotification = (message, type) => { notifications.push({ message, type }); };

  player.processFolderFiles([], 'lyrics');

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'warning');
});

await test('processFolderFiles warns when no valid files exist', () => {
  const notifications = [];
  player.showNotification = (message, type) => { notifications.push({ message, type }); };

  const files = [
    { name: 'image.png', webkitRelativePath: 'a/image.png' },
    { name: 'video.mp4x', webkitRelativePath: 'b/video.mp4x' }
  ];

  player.processFolderFiles(files, 'lyrics');

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'warning');
});

await test('reorderSongs adjusts current index correctly', () => {
  player.songs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  player.currentSongIndex = 1;
  player.updatePlaylist = () => {};
  player.updateSongDisplay = () => {};

  player.reorderSongs(0, 2);
  assert.equal(player.currentSongIndex, 0);
  assert.equal(player.songs.map(song => song.name).join(','), 'b,c,a');

  player.currentSongIndex = 2;
  player.reorderSongs(2, 0);
  assert.equal(player.currentSongIndex, 0);
  assert.equal(player.songs.map(song => song.name).join(','), 'a,b,c');
});

await test('random play mode avoids repeats until history resets', () => {
  player.songs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  player.playMode = 'random';
  player.currentSongIndex = 0;
  player.playHistory = [0, 1, 2];

  const nextIndex = player.getNextSongIndex();

  assert.equal(player.playHistory.length, 1);
  assert.ok(nextIndex >= 0 && nextIndex < player.songs.length);
});

await test('applyModeChange reconfigures playback and resumes', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  let pauseCalls = 0;
  let playCalls = 0;
  let setupCalls = 0;
  let setTimeCalls = 0;

  player.pause = () => { pauseCalls += 1; player.isPlaying = false; };
  player.play = () => { playCalls += 1; player.isPlaying = true; };
  player.setupPlaybackMode = () => { setupCalls += 1; };
  player.setCurrentTime = () => { setTimeCalls += 1; };

  player.isPlaying = true;
  player.currentTime = 12;

  player.applyModeChange({ userMode: 'lyrics', lyrics: [{ time: 0, text: 'a' }] });

  assert.equal(pauseCalls, 1);
  assert.equal(setupCalls, 1);
  assert.equal(setTimeCalls, 1);
  assert.equal(playCalls, 1);

  globalThis.setTimeout = originalSetTimeout;
});

await test('loadBackgroundImage revokes previous blob URL', () => {
  const revoked = [];
  const created = [];
  const originalURL = globalThis.URL;

  globalThis.URL = {
    createObjectURL(file) {
      const url = `blob:${file.name}`;
      created.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };

  player.backgroundContainer = createElement();
  player.trackObjectUrl = () => {};
  player.showNotification = () => {};

  player.backgroundContainer.style.backgroundImage = 'url("blob:old")';
  player.revokeObjectUrl = (url) => {
    globalThis.URL.revokeObjectURL(url);
  };

  player.loadBackgroundImage({ name: 'new' });

  assert.equal(revoked[0], 'blob:old');
  assert.equal(created[0], 'blob:new');

  globalThis.URL = originalURL;
});
