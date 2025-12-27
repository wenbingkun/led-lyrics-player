import assert from 'node:assert/strict';
import {
  test,
  player,
  LEDLyricsPlayer,
  createElement,
  installDocumentStub,
  flushPromises
} from './test-helpers.mjs';

await test('updateAudioMode does not throw when syncControls is missing', () => {
  const currentSongStatus = createElement();
  const elements = {
    currentSongStatus,
    syncControls: null
  };
  installDocumentStub(elements);

  player.currentSongStatus = currentSongStatus;
  player.songs = [{ name: 'a', lyrics: [{ time: 0, text: 'a' }], audioFile: null }];
  player.currentSongIndex = 0;
  player.isPlaying = false;

  assert.doesNotThrow(() => {
    player.updateAudioMode();
  });
  assert.equal(player.currentSongStatus.textContent, '纯歌词模式 (手动控制)');
});

await test('updateAudioMode does not throw when status element is missing', () => {
  installDocumentStub({ syncControls: createElement() });

  player.currentSongStatus = null;
  player.songs = [{ name: 'a', lyrics: [{ time: 0, text: 'a' }], audioFile: null }];
  player.currentSongIndex = 0;
  player.isPlaying = false;

  assert.doesNotThrow(() => {
    player.updateAudioMode();
  });
});

await test('updateSongDisplay formats song names without prefixes', () => {
  player.updateSongDisplay = LEDLyricsPlayer.prototype.updateSongDisplay.bind(player);
  const displaySongTitle = createElement();
  const displaySongIndex = createElement();
  const songInfo = createElement();
  const currentSongInfo = createElement();
  const currentSongName = createElement();
  const currentSongStatus = createElement();

  installDocumentStub({
    displaySongTitle,
    displaySongIndex,
    songInfo,
    currentSongInfo,
    currentSongName,
    currentSongStatus
  });

  player.displaySongTitle = displaySongTitle;
  player.displaySongIndex = displaySongIndex;
  player.songInfo = songInfo;
  player.currentSongInfo = currentSongInfo;
  player.currentSongName = currentSongName;
  player.currentSongStatus = currentSongStatus;

  player.songs = [{ name: '01_intro-track', lyrics: [{ time: 0, text: 'a' }] }];
  player.currentSongIndex = 0;
  player.isPlaying = false;

  player.updateSongDisplay();

  assert.equal(player.displaySongTitle.textContent, 'intro-track');
  assert.equal(player.displaySongIndex.textContent, '1 / 1');
  assert.equal(player.currentSongName.textContent, 'intro-track');
});

await test('updateSongDisplay handles missing elements safely', () => {
  installDocumentStub({});

  player.displaySongTitle = null;
  player.displaySongIndex = null;
  player.songInfo = null;
  player.currentSongInfo = null;
  player.currentSongName = null;
  player.currentSongStatus = null;

  player.songs = [{ name: '01_intro-track', lyrics: [{ time: 0, text: 'a' }] }];
  player.currentSongIndex = 0;
  player.isPlaying = false;

  assert.doesNotThrow(() => {
    player.updateSongDisplay();
  });
});

await test('updateStatusIndicator handles missing element safely', () => {
  player.statusIndicator = null;
  player.songs = [];
  player.isPlaying = false;

  assert.doesNotThrow(() => {
    player.updateStatusIndicator();
  });
});

await test('showLyrics handles missing elements safely', () => {
  player.currentLyricEl = null;
  player.nextLyricEl = null;

  assert.doesNotThrow(() => {
    player.showLyrics('a', 'b');
  });
});

await test('updateProgress handles missing elements safely', () => {
  player.progressBar = null;
  player.currentTimeSpan = null;
  player.totalTimeSpan = null;

  player.songs = [{ name: 'a', duration: 10 }];
  player.currentSongIndex = 0;
  player.currentTime = 1;
  player.audioMode = false;
  player.audioElement = null;

  assert.doesNotThrow(() => {
    player.updateProgress();
  });
});

await test('showMatchingReport reports based on effective modes', () => {
  player.showMatchingReport = LEDLyricsPlayer.prototype.showMatchingReport.bind(player);
  let notification = null;
  player.showNotification = (message, type) => {
    notification = { message, type };
  };

  player.songs = [
    { name: 'sync-song', lyrics: [{ time: 0, text: 'a' }], audioFile: {} },
    { name: 'audio-only', audioFile: {} },
    { name: 'lyrics-only', lyrics: [{ time: 0, text: 'a' }] }
  ];

  player.showMatchingReport();

  assert.ok(notification);
  assert.equal(notification.type, 'info');
  assert.ok(notification.message.includes('1/3'));
});

await test('searchLyrics warns when no song is selected', () => {
  const notifications = [];
  player.showNotification = (message, type) => { notifications.push({ message, type }); };
  installDocumentStub({ searchResults: createElement() });

  player.currentSongIndex = -1;
  player.searchLyrics('hello');

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'warning');
});

await test('searchLyrics populates results for matching lines', () => {
  const searchResults = createElement();
  installDocumentStub({ searchResults });

  player.currentSongIndex = 0;
  player.songs = [{
    name: 'a',
    lyrics: [
      { time: 1, text: 'hello world' },
      { time: 2, text: 'goodbye' },
      { time: 3, text: 'hello again' }
    ]
  }];

  player.searchLyrics('hello');

  assert.equal(searchResults.style.display, 'block');
  assert.equal(searchResults.children.length, 2);
});

await test('clearSearch hides and clears results', () => {
  const searchResults = createElement();
  searchResults.innerHTML = '<div>result</div>';
  searchResults.style.display = 'block';
  installDocumentStub({ searchResults });

  player.clearSearch();

  assert.equal(searchResults.style.display, 'none');
  assert.equal(searchResults.innerHTML, '');
});

await test('updateLyricsDisplay chooses correct current and next lines', () => {
  let lastLyrics = null;
  player.showLyrics = (current, next) => {
    lastLyrics = { current, next };
  };

  player.songs = [{
    name: 'a',
    lyrics: [
      { time: 1, text: 'line1' },
      { time: 2, text: 'line2' }
    ]
  }];
  player.currentSongIndex = 0;
  player.currentLyricIndex = 0;
  player.lastLyricSearchIndex = 0;
  player.lastLyricSearchTime = 0;

  player.currentTime = 0.5;
  player.updateLyricsDisplay();
  assert.deepEqual(lastLyrics, { current: '...', next: '' });

  player.currentTime = 1.1;
  player.updateLyricsDisplay();
  assert.deepEqual(lastLyrics, { current: 'line1', next: 'line2' });
});

await test('togglePlay/play/pause manage audio playback state', async () => {
  player.togglePlay = LEDLyricsPlayer.prototype.togglePlay.bind(player);
  player.play = LEDLyricsPlayer.prototype.play.bind(player);
  player.pause = LEDLyricsPlayer.prototype.pause.bind(player);
  const playButton = createElement();
  player.playButton = playButton;
  player.showNotification = () => {};
  player.updateStatusIndicator = () => {};
  player.updateSongDisplay = () => {};
  player.requestWakeLock = () => {};
  player.releaseWakeLock = () => {};

  let playCalls = 0;
  let pauseCalls = 0;
  const audioElement = {
    currentTime: 0,
    playbackRate: 1,
    play() {
      playCalls += 1;
      return Promise.resolve();
    },
    pause() {
      pauseCalls += 1;
    }
  };

  player.songs = [{
    name: 'a',
    lyrics: [{ time: 0, text: 'a' }],
    duration: 10,
    audioFile: {}
  }];
  player.currentSongIndex = 0;
  player.audioMode = true;
  player.audioElement = audioElement;
  player.currentTime = 0;
  player.audioOffset = 0;
  player.isPlaying = false;
  player.timers = new Set();

  player.togglePlay();
  await flushPromises();
  assert.equal(player.isPlaying, true);
  assert.equal(playButton.textContent, '⏸');
  assert.equal(playCalls, 1);

  player.togglePlay();
  assert.equal(player.isPlaying, false);
  assert.equal(playButton.textContent, '▶');
  assert.equal(pauseCalls, 1);
});

await test('syncWithAudio updates progress and lyrics on timeupdate', async () => {
  let progressCalls = 0;
  let lyricsCalls = 0;

  const originalPerf = globalThis.performance;
  const originalRAF = globalThis.requestAnimationFrame;
  const originalUpdateProgress = player.updateProgress;
  const originalUpdateLyricsDisplay = player.updateLyricsDisplay;

  globalThis.performance = { now: () => 1000 };
  globalThis.requestAnimationFrame = (cb) => cb();

  player.audioMode = true;
  player.audioOffset = 0;
  player.audioElement = { currentTime: 5 };
  player.lastLyricsUpdate = 0;
  player.updateProgress = () => { progressCalls += 1; };
  player.updateLyricsDisplay = () => { lyricsCalls += 1; };

  player.syncWithAudio();

  assert.equal(player.currentTime, 5);
  assert.equal(progressCalls, 1);
  assert.equal(lyricsCalls, 1);

  globalThis.performance = originalPerf;
  globalThis.requestAnimationFrame = originalRAF;
  player.updateProgress = originalUpdateProgress;
  player.updateLyricsDisplay = originalUpdateLyricsDisplay;
});

await test('seek updates time and progress', () => {
  player.seek = LEDLyricsPlayer.prototype.seek.bind(player);
  player.setCurrentTime = LEDLyricsPlayer.prototype.setCurrentTime.bind(player);
  const progressBar = createElement();
  const currentTimeSpan = createElement();
  const totalTimeSpan = createElement();

  player.progressBar = progressBar;
  player.currentTimeSpan = currentTimeSpan;
  player.totalTimeSpan = totalTimeSpan;
  player.updateLyricsDisplay = () => {};
  player.showNotification = () => {};

  player.songs = [{ name: 'a', duration: 100 }];
  player.currentSongIndex = 0;
  player.currentTime = 10;
  player.audioMode = false;
  player.audioElement = null;

  const baseUpdateProgress = LEDLyricsPlayer.prototype.updateProgress.bind(player);
  let progressCalls = 0;
  player.updateProgress = () => {
    progressCalls += 1;
    baseUpdateProgress();
  };

  player.seek(15);
  assert.equal(player.currentTime, 25);
  assert.equal(progressCalls, 1);
  player.updateProgress();
  assert.ok(progressBar.style.width.endsWith('%'));
});

await test('seekTo sets current time based on click position', () => {
  player.seekTo = LEDLyricsPlayer.prototype.seekTo.bind(player);
  player.setCurrentTime = LEDLyricsPlayer.prototype.setCurrentTime.bind(player);
  const progressBar = createElement();
  const currentTimeSpan = createElement();
  const totalTimeSpan = createElement();
  const progressContainer = createElement();
  progressContainer.getBoundingClientRect = () => ({ left: 0, width: 200 });

  player.progressBar = progressBar;
  player.currentTimeSpan = currentTimeSpan;
  player.totalTimeSpan = totalTimeSpan;
  player.progressContainer = progressContainer;
  player.updateLyricsDisplay = () => {};

  player.songs = [{ name: 'a', duration: 100 }];
  player.currentSongIndex = 0;
  player.currentTime = 0;
  player.audioMode = false;
  player.audioElement = null;

  player.seekTo({ clientX: 50 });
  assert.equal(player.currentTime, 25);
});

await test('keyboard shortcuts trigger expected actions', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  const elements = {
    lrcFile: createElement(),
    audioFile: createElement(),
    backgroundFile: createElement(),
    lrcFolderBtn: createElement(),
    lrcFolder: createElement(),
    audioFolderBtn: createElement(),
    audioFolder: createElement(),
    playButton: createElement(),
    progressContainer: createElement(),
    lyricsSearch: createElement(),
    searchButton: createElement(),
    clearSearch: createElement(),
    exportPlaylist: createElement(),
    sortPlaylist: createElement(),
    importPlaylist: createElement(),
    clearPlaylist: createElement(),
    playlistFile: createElement(),
    syncControls: createElement()
  };

  installDocumentStub(elements);

  let playCalls = 0;
  let seekCalls = 0;
  let prevSongCalls = 0;
  let nextSongCalls = 0;
  let prevLyricCalls = 0;
  let nextLyricCalls = 0;
  let firstLyricCalls = 0;
  let lastLyricCalls = 0;
  let toggleFullscreenCalls = 0;
  let adjustFontCalls = 0;
  let switchThemeCalls = 0;
  let switchPlayModeCalls = 0;
  let adjustOffsetCalls = 0;
  let switchToSongCalls = 0;
  let focusCalls = 0;

  elements.lyricsSearch.focus = () => { focusCalls += 1; };

  player.playButton = elements.playButton;
  player.progressContainer = elements.progressContainer;
  player.currentSongIndex = 0;
  player.songs = [{ name: 'a', duration: 10, lyrics: [{ time: 0, text: 'a' }] }];
  player.showLyricJumpNotification = () => {};
  player.timers = new Set();

  player.togglePlay = () => { playCalls += 1; };
  player.play = () => { playCalls += 1; };
  player.seek = () => { seekCalls += 1; };
  player.switchToPreviousSong = () => { prevSongCalls += 1; };
  player.switchToNextSong = () => { nextSongCalls += 1; };
  player.previousLyric = () => { prevLyricCalls += 1; return true; };
  player.nextLyric = () => { nextLyricCalls += 1; return true; };
  player.firstLyric = () => { firstLyricCalls += 1; return true; };
  player.lastLyric = () => { lastLyricCalls += 1; return true; };
  player.toggleFullscreen = () => { toggleFullscreenCalls += 1; };
  player.adjustFontSize = () => { adjustFontCalls += 1; };
  player.switchTheme = () => { switchThemeCalls += 1; };
  player.switchPlayMode = () => { switchPlayModeCalls += 1; };
  player.adjustOffset = () => { adjustOffsetCalls += 1; };
  player.switchToSong = () => { switchToSongCalls += 1; };

  player.initEventListeners();

  const keydownHandlers = globalThis.document._listeners.get('keydown') || [];
  const handler = keydownHandlers[0];

  const trigger = (event) => {
    let prevented = false;
    handler({
      target: { tagName: 'DIV' },
      preventDefault() { prevented = true; },
      ...event
    });
    return prevented;
  };

  assert.ok(trigger({ code: 'Space' }));
  assert.ok(trigger({ code: 'ArrowLeft' }));
  assert.ok(trigger({ code: 'ArrowRight' }));
  assert.ok(trigger({ code: 'ArrowUp' }));
  assert.ok(trigger({ code: 'ArrowDown' }));
  assert.ok(trigger({ code: 'ArrowLeft', ctrlKey: true }));
  assert.ok(trigger({ code: 'ArrowRight', ctrlKey: true }));
  assert.ok(trigger({ code: 'ArrowUp', ctrlKey: true }));
  assert.ok(trigger({ code: 'ArrowDown', ctrlKey: true }));
  trigger({ code: 'Escape' });
  trigger({ key: '+' });
  trigger({ key: '-' });
  trigger({ key: 't' });
  trigger({ key: 'm' });
  trigger({ key: 'f' });
  trigger({ key: '[' });
  trigger({ key: ']' });
  trigger({ code: 'Digit1' });

  assert.equal(playCalls >= 2, true);
  assert.equal(seekCalls, 2);
  assert.equal(prevSongCalls, 1);
  assert.equal(nextSongCalls, 1);
  assert.equal(prevLyricCalls, 1);
  assert.equal(nextLyricCalls, 1);
  assert.equal(firstLyricCalls, 1);
  assert.equal(lastLyricCalls, 1);
  assert.equal(toggleFullscreenCalls, 1);
  assert.equal(adjustFontCalls, 2);
  assert.equal(switchThemeCalls, 1);
  assert.equal(switchPlayModeCalls, 1);
  assert.equal(adjustOffsetCalls, 2);
  assert.equal(switchToSongCalls, 1);
  assert.equal(focusCalls, 1);

  globalThis.setTimeout = originalSetTimeout;
});

await test('searchResults click jumps to lyric and plays', async () => {
  const searchResults = createElement();
  installDocumentStub({ searchResults });

  let setTimeCalls = 0;
  let playCalls = 0;

  player.setCurrentTime = () => { setTimeCalls += 1; };
  player.play = () => { playCalls += 1; };
  player.isPlaying = false;

  player.currentSongIndex = 0;
  player.songs = [{
    name: 'a',
    lyrics: [
      { time: 1, text: 'hello world' },
      { time: 2, text: 'hello again' }
    ]
  }];

  player.searchLyrics('hello');

  const item = searchResults.children[0];
  const clickHandlers = item._listeners.get('click') || [];
  clickHandlers[0]();

  assert.equal(setTimeCalls, 1);
  assert.equal(playCalls, 1);
  assert.equal(searchResults.style.display, 'none');
});

await test('drag and drop reorders songs on drop', () => {
  const playlist = createElement();
  const itemA = createElement();
  const itemB = createElement();
  itemA.dataset = { index: '0' };
  itemB.dataset = { index: '1' };
  itemB.getBoundingClientRect = () => ({ top: 0, height: 100 });

  playlist.querySelectorAll = () => [itemA, itemB];
  player.playlist = playlist;

  player.songs = [{ name: 'a' }, { name: 'b' }];
  player.currentSongIndex = 0;
  player.reorderSongs = (fromIndex, toIndex) => {
    player._reordered = { fromIndex, toIndex };
  };

  player.initSongItemDragEvents(itemA, createElement());
  player.initSongItemDragEvents(itemB, createElement());

  const dropHandlers = itemB._listeners.get('drop') || [];
  dropHandlers[0]({
    preventDefault() {},
    dataTransfer: {
      getData() { return '0'; }
    },
    clientY: 100,
    target: itemB
  });

  assert.equal(player._reordered.fromIndex, 0);
  assert.equal(player._reordered.toIndex, 1);
});

await test('audio ended triggers next song based on play mode', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    fn();
    return 1;
  };

  let switchCalls = 0;
  let playCalls = 0;
  let setTimeCalls = 0;

  player.switchToSong = () => { switchCalls += 1; };
  player.play = () => { playCalls += 1; };
  player.setCurrentTime = () => { setTimeCalls += 1; };
  player.pause = () => {};

  player.songs = [{ name: 'a' }, { name: 'b' }];
  player.currentSongIndex = 0;
  player.playMode = 'single';
  player.timers = new Set();

  player.onSongEnded();

  assert.equal(setTimeCalls, 1);
  assert.equal(playCalls, 1);
  assert.equal(switchCalls, 0);

  player.playMode = 'list';
  player.currentSongIndex = 0;
  setTimeCalls = 0;
  playCalls = 0;
  switchCalls = 0;

  player.onSongEnded();

  assert.equal(switchCalls, 1);
  assert.equal(playCalls, 1);
  assert.equal(setTimeCalls, 0);

  globalThis.setTimeout = originalSetTimeout;
});

await test('updateLyricProgress reflects lyric count and mode', () => {
  const lyricProgress = createElement();
  const lyricProgressText = createElement();
  installDocumentStub({ lyricProgress, lyricProgressText });

  player.songs = [{
    name: 'a',
    lyrics: [
      { time: 0, text: 'a' },
      { time: 1, text: 'b' }
    ]
  }];
  player.currentSongIndex = 0;
  player.currentLyricIndex = 0;
  player.getEffectiveMode = () => 'lyrics';

  player.updateLyricProgress();

  assert.equal(lyricProgress.style.display, 'block');
  assert.equal(lyricProgressText.textContent, '歌词 1 / 2');

  player.getEffectiveMode = () => 'audio';
  player.updateLyricProgress();
  assert.equal(lyricProgress.style.display, 'none');
});

await test('switchToSong cleans up old audio and updates references', () => {
  player.switchToSong = LEDLyricsPlayer.prototype.switchToSong.bind(player);
  const oldAudio = {
    pauseCalls: 0,
    pause() { this.pauseCalls += 1; },
    src: 'blob:old',
    _blobUrl: 'blob:old'
  };
  const newAudio = {
    addEventListener() {},
    pause() {},
    src: '',
    _blobUrl: 'blob:new'
  };

  const oldSong = {
    name: 'old',
    lyrics: [{ time: 0, text: 'a' }],
    audioFile: {},
    audioElement: oldAudio
  };
  const newSong = {
    name: 'new',
    lyrics: [{ time: 0, text: 'b' }],
    audioFile: {},
    audioElement: newAudio
  };

  player.songs = [oldSong, newSong];
  player.currentSongIndex = 0;
  player.audioMode = true;
  player.audioElement = oldAudio;
  player.revokeObjectUrl = (url) => { player._revoked = url; };
  player.pause = () => {
    player.audioElement = null;
    player.isPlaying = false;
  };
  player.updateSongDisplay = () => {};
  player.updatePlaylist = () => {};
  player.updateLyricsDisplay = () => {};
  player.updateProgress = () => {};
  player.updateAudioMode = () => {};
  player.showLyrics = () => {};
  player.playButton = { disabled: false };
  player.totalTimeSpan = createElement();
  player.progressBar = createElement();
  player.clearSearch = () => {};
  player.lyricsCache = new Map();
  player.playMode = 'list';
  player.playHistory = [];
  player.getSongMode = () => 'audio';
  player.showNotification = () => {};

  player.switchToSong(1);

  assert.equal(oldSong.audioElement, null);
  assert.equal(oldAudio.src, '');
  assert.equal(player._revoked, 'blob:old');
  assert.equal(player.audioElement, newAudio);
});

await test('searchResults click updates lyric index and cache', () => {
  const searchResults = createElement();
  installDocumentStub({ searchResults });

  player.currentSongIndex = 0;
  player.currentLyricIndex = -1;
  player.lastLyricSearchIndex = 0;
  player.updateLyricsDisplay = () => {};
  player.setCurrentTime = () => {};
  player.isPlaying = true;
  player.songs = [{
    name: 'a',
    lyrics: [
      { time: 1, text: 'hello world' },
      { time: 2, text: 'hello again' }
    ]
  }];

  player.searchLyrics('hello');

  const item = searchResults.children[1];
  const clickHandlers = item._listeners.get('click') || [];
  clickHandlers[0]();

  assert.equal(player.currentLyricIndex, 1);
  assert.equal(player.lastLyricSearchIndex, 1);
});
