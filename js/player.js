import { CONFIG } from './config.js';
import { log, warn, error, escapeHtml, highlightText, formatTime as formatTimeUtil } from './utils.js';

export class LEDLyricsPlayer {
    constructor() {
        this.playButton = document.getElementById('playButton');
        this.progressBar = document.getElementById('progressBar');
        this.progressContainer = document.getElementById('progressContainer');
        this.currentTimeSpan = document.getElementById('currentTime');
        this.totalTimeSpan = document.getElementById('totalTime');
        this.currentLyricEl = document.getElementById('currentLyric');
        this.nextLyricEl = document.getElementById('nextLyric');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.backgroundContainer = document.getElementById('backgroundContainer');
        this.playlist = document.getElementById('playlist');
        this.playlistCount = document.getElementById('playlistCount');
        this.songInfo = document.getElementById('songInfo');
        this.displaySongTitle = document.getElementById('displaySongTitle');
        this.displaySongIndex = document.getElementById('displaySongIndex');
        this.currentSongInfo = document.getElementById('currentSongInfo');
        this.currentSongName = document.getElementById('currentSongName');
        this.currentSongStatus = document.getElementById('currentSongStatus');

        this.songs = []; // 歌曲列表
        this.currentSongIndex = -1; // 当前播放歌曲索引
        this.currentLyricIndex = -1; // 当前歌词索引
        this.isPlaying = false;
        this.currentTime = 0;
        this.playbackSpeed = 1;
        this.animationId = null;
        this.startTime = null;
        this.pausedTime = 0;
        this.lastProgressUpdate = 0;
        this.lastLyricsUpdate = 0;
        this.lastLyricSearchIndex = 0; // 新增：记录上次查找到的索引
        this.lastLyricSearchTime = 0;  // 新增：记录上次查找的时间
        this.lyricsCache = new Map();

        // 音频播放支持
        this.audioElement = null;
        this.audioMode = false; // false: 纯歌词模式, true: 音频同步模式
        this.audioOffset = 0; // 音频与歌词的时间偏移
        this.fontScale = 1.3; // 字体缩放比例
        this.currentTheme = 'classic'; // 当前主题
        this.searchResults = []; // 搜索结果
        this.objectUrls = new Set(); // 跟踪创建的URL对象
        this.eventListeners = new Map(); // 跟踪事件监听器
        this.eventListenerRegistry = new Map(); // 增强的事件监听器注册表
        this.timers = new Set(); // 跟踪定时器
        this.cursorTimeout = null; // 光标隐藏定时器

        // 播放模式
        this.playMode = 'loop'; // 'list': 列表播放, 'loop': 列表循环, 'single': 单曲循环, 'random': 随机播放
        this.playHistory = []; // 随机播放历史记录

        // 防止屏幕熄屏
        this.wakeLock = null; // Screen Wake Lock API
        this.wakeLockSupported = 'wakeLock' in navigator; // 检查浏览器支持

        // 拖拽状态
        this.draggedElement = null; // 当前拖拽的元素

        // 浏览器兼容性检查
        this.checkBrowserCompatibility();

        // 页面卸载时清理资源
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // 页面可见性变化监听器
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });

        // 加载保存的设置
        this.loadSettings();

        this.initEventListeners();
        this.initCursorHiding();
        this.initDragAndDrop();

        // 初始化控制台交互 (点击锁定)
        this.initPanelInteraction();
    }

    // 防抖函数工具
    debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    // 初始化控制台交互
    initPanelInteraction() {
        const triggerZone = document.querySelector('.trigger-zone');
        const controlPanel = document.querySelector('.control-panel');

        if (triggerZone && controlPanel) {
            triggerZone.addEventListener('click', (e) => {
                e.stopPropagation();
                controlPanel.classList.toggle('active');
                const isActive = controlPanel.classList.contains('active');
                this.showNotification(isActive ? '控制台已锁定' : '控制台自动隐藏', 'info', 1500);
            });

            // 点击控制台内部不关闭
            controlPanel.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // 点击页面其他地方关闭控制台
            document.addEventListener('click', () => {
                if (controlPanel.classList.contains('active')) {
                    controlPanel.classList.remove('active');
                }
            });
        }
    }

    // 加载设置
    loadSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('led_lyrics_player_settings'));
            if (settings) {
                if (settings.theme) this.setTheme(settings.theme);
                if (settings.fontSize) this.setFontScale(settings.fontSize);
                if (settings.speed) this.setPlaybackSpeed(settings.speed);
                if (settings.playMode) this.setPlayMode(settings.playMode);
                log('已加载用户设置');
            }
        } catch (e) {
            warn('加载设置失败:', e);
        }
    }

    // 保存设置
    saveSettings() {
        const settings = {
            theme: this.currentTheme,
            fontSize: this.fontScale,
            speed: this.playbackSpeed,
            playMode: this.playMode
        };
        localStorage.setItem('led_lyrics_player_settings', JSON.stringify(settings));
    }

    // 浏览器兼容性检查
    checkBrowserCompatibility() {
        // 检查文件夹选择API支持
        const folderSupported = 'webkitdirectory' in document.createElement('input');

        const lrcHint = document.getElementById('lrcFolderHint');
        const audioHint = document.getElementById('audioFolderHint');

        if (!folderSupported) {
            // 不支持文件夹选择
            const warningText = '注意：当前浏览器不支持文件夹选择功能，请使用基于Chromium的浏览器（如Chrome、Edge）';

            if (lrcHint) {
                lrcHint.textContent = warningText;
                lrcHint.className = 'compatibility-hint warning';
                lrcHint.style.display = 'block';
            }

            if (audioHint) {
                audioHint.textContent = warningText;
                audioHint.className = 'compatibility-hint warning';
                audioHint.style.display = 'block';
            }

            // 禁用文件夹按钮
            const lrcFolderBtn = document.getElementById('lrcFolderBtn');
            const audioFolderBtn = document.getElementById('audioFolderBtn');

            if (lrcFolderBtn) {
                lrcFolderBtn.disabled = true;
                lrcFolderBtn.title = '当前浏览器不支持文件夹选择功能';
            }

            if (audioFolderBtn) {
                audioFolderBtn.disabled = true;
                audioFolderBtn.title = '当前浏览器不支持文件夹选择功能';
            }
        } else {
            // 支持文件夹选择，显示兼容性提示
            const infoText = '支持文件夹选择 (Chrome/Edge/Opera等浏览器)';

            if (lrcHint) {
                lrcHint.textContent = infoText;
                lrcHint.className = 'compatibility-hint';
                lrcHint.style.display = 'block';
            }

            if (audioHint) {
                audioHint.textContent = infoText;
                audioHint.className = 'compatibility-hint';
                audioHint.style.display = 'block';
            }
        }
    }

    // 增强的事件监听器管理方法
    addEventListenerTracked(element, eventType, handler, options = {}) {
        const key = `${element.constructor.name}_${eventType}_${Date.now()}_${Math.random()}`;

        // 存储事件监听器信息
        this.eventListenerRegistry.set(key, {
            element,
            eventType,
            handler,
            options
        });

        // 添加事件监听器
        element.addEventListener(eventType, handler, options);

        return key; // 返回key用于后续移除
    }

    removeEventListenerTracked(key) {
        const listenerInfo = this.eventListenerRegistry.get(key);
        if (listenerInfo) {
            const { element, eventType, handler, options } = listenerInfo;
            element.removeEventListener(eventType, handler, options);
            this.eventListenerRegistry.delete(key);
            return true;
        }
        return false;
    }

    removeAllEventListeners() {
        for (const [key, listenerInfo] of this.eventListenerRegistry) {
            const { element, eventType, handler, options } = listenerInfo;
            try {
                element.removeEventListener(eventType, handler, options);
            } catch (error) {
                warn('移除事件监听器时出错:', error);
            }
        }
        this.eventListenerRegistry.clear();
    }

    initCursorHiding() {
        const showCursor = () => {
            document.body.classList.remove('auto-hide-cursor');
            if (this.cursorTimeout) {
                clearTimeout(this.cursorTimeout);
            }
            this.cursorTimeout = setTimeout(() => {
                document.body.classList.add('auto-hide-cursor');
            }, 3000);
            this.timers.add(this.cursorTimeout);
        };

        // 使用新的事件监听器跟踪系统
        this.addEventListenerTracked(document, 'mousemove', showCursor);
        this.addEventListenerTracked(document, 'mousedown', showCursor);

        // 存储事件监听器引用用于清理（保持兼容性）
        this.eventListeners.set('mousemove', showCursor);
        this.eventListeners.set('mousedown', showCursor);

        // 初始显示光标
        showCursor();
    }


    initDragAndDrop() {
        const dragOverlay = document.getElementById('dragOverlay');
        let dragCounter = 0;

        // 防止默认拖拽行为
        const preventDefaultHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.addEventListenerTracked(document, eventName, preventDefaultHandler);
        });

        // 拖拽进入
        const dragEnterHandler = (e) => {
            dragCounter++;
            if (e.dataTransfer.types.includes('Files')) {
                dragOverlay.classList.add('active');
            }
        };
        this.addEventListenerTracked(document, 'dragenter', dragEnterHandler);

        // 拖拽离开
        const dragLeaveHandler = (e) => {
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                dragOverlay.classList.remove('active');
            }
        };
        this.addEventListenerTracked(document, 'dragleave', dragLeaveHandler);

        // 放开文件
        const dropHandler = (e) => {
            dragCounter = 0;
            dragOverlay.classList.remove('active');

            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                this.handleDroppedFiles(files);
            }
        };
        this.addEventListenerTracked(document, 'drop', dropHandler);
    }

    handleDroppedFiles(files) {
        const lrcFiles = [];
        const audioFiles = [];
        const imageFiles = [];

        files.forEach(file => {
            const ext = file.name.toLowerCase().split('.').pop();
            if (ext === 'lrc' || ext === 'txt') {
                lrcFiles.push(file);
            } else if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'mp4'].includes(ext)) {
                audioFiles.push(file);
            } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
                imageFiles.push(file);
            }
        });

        // 处理歌词文件
        if (lrcFiles.length > 0) {
            log('拖拽上传歌词文件:', lrcFiles.length, '个');
            this.loadLrcFiles(lrcFiles);
        }

        // 处理音频文件
        if (audioFiles.length > 0) {
            log('拖拽上传音频文件:', audioFiles.length, '个');
            this.loadAudioFiles(audioFiles);
        }

        // 处理背景图片
        if (imageFiles.length > 0) {
            log('拖拽上传背景图片:', imageFiles[0].name);
            this.loadBackgroundImage(imageFiles[0]);
        }
    }

    initEventListeners() {
        // 文件上传
        document.getElementById('lrcFile').addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            log('选择了', files.length, '个文件');
            this.loadLrcFiles(files);
        });

        document.getElementById('audioFile').addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            log('选择了', files.length, '个音频文件');
            this.loadAudioFiles(files);
        });

        document.getElementById('backgroundFile').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                log('开始加载背景图片:', file.name);
                this.loadBackgroundImage(file);
            }
        });

        // 文件夹选择
        document.getElementById('lrcFolderBtn').addEventListener('click', () => {
            document.getElementById('lrcFolder').click();
        });

        document.getElementById('lrcFolder').addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.processFolderFiles(files, 'lyrics');
        });

        document.getElementById('audioFolderBtn').addEventListener('click', () => {
            document.getElementById('audioFolder').click();
        });

        document.getElementById('audioFolder').addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            this.processFolderFiles(files, 'audio');
        });

        // 播放控制
        this.playButton.addEventListener('click', () => {
            this.togglePlay();
        });

        // 进度条控制
        this.progressContainer.addEventListener('click', (e) => {
            this.seekTo(e);
        });

        // 速度控制
        document.querySelectorAll('.speed-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.setPlaybackSpeed(parseFloat(e.target.dataset.speed));
                this.saveSettings();
            });
        });

        // 字体大小控制
        document.querySelectorAll('.font-size-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.setFontScale(parseFloat(e.target.dataset.fontSize));
                this.saveSettings();
            });
        });

        // 主题控制
        document.querySelectorAll('.theme-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.setTheme(e.target.dataset.theme);
                this.saveSettings();
            });
        });

        // 播放模式控制
        document.querySelectorAll('.play-mode-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.setPlayMode(e.target.dataset.mode);
                this.saveSettings();
            });
        });


        // 搜索功能
        const searchInput = document.getElementById('lyricsSearch');
        const searchButton = document.getElementById('searchButton');
        const clearSearch = document.getElementById('clearSearch');

        // 使用防抖处理搜索输入
        const debouncedSearch = this.debounce((value) => {
            this.searchLyrics(value);
        }, 300);

        searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });

        searchButton.addEventListener('click', () => {
            this.searchLyrics(searchInput.value);
        });

        clearSearch.addEventListener('click', () => {
            searchInput.value = '';
            this.clearSearch();
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.searchLyrics(searchInput.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                this.clearSearch();
            }
        });

        // 播放列表功能
        document.getElementById('exportPlaylist').addEventListener('click', () => {
            this.exportPlaylist();
        });

        document.getElementById('sortPlaylist').addEventListener('click', () => {
            this.sortPlaylist();
        });

        document.getElementById('importPlaylist').addEventListener('click', () => {
            document.getElementById('playlistFile').click();
        });

        document.getElementById('clearPlaylist').addEventListener('click', () => {
            this.clearPlaylist();
        });

        document.getElementById('playlistFile').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.importPlaylist(file);
                e.target.value = ''; // 重置文件选择
            }
        });

        // 同步校准功能
        document.querySelectorAll('.sync-button').forEach(button => {
            if (button.id === 'resetOffset') {
                button.addEventListener('click', () => {
                    this.resetOffset();
                });
            } else {
                button.addEventListener('click', (e) => {
                    const offset = parseFloat(e.target.dataset.offset);
                    this.adjustOffset(offset);
                });
            }
        });

        // 键盘控制
        document.addEventListener('keydown', (e) => {
            // 如果正在输入框中，不处理快捷键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            } else if (e.code === 'ArrowLeft' && !e.ctrlKey) {
                e.preventDefault();
                this.seek(-5);
            } else if (e.code === 'ArrowRight' && !e.ctrlKey) {
                e.preventDefault();
                this.seek(5);
            } else if (e.code === 'ArrowUp' && !e.ctrlKey) {
                e.preventDefault();
                this.switchToPreviousSong();
            } else if (e.code === 'ArrowDown' && !e.ctrlKey) {
                e.preventDefault();
                this.switchToNextSong();
            } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
                e.preventDefault();
                if (this.previousLyric()) {
                    this.showLyricJumpNotification('上一句');
                }
            } else if (e.code === 'ArrowRight' && e.ctrlKey) {
                e.preventDefault();
                if (this.nextLyric()) {
                    this.showLyricJumpNotification('下一句');
                }
            } else if (e.code === 'ArrowUp' && e.ctrlKey) {
                e.preventDefault();
                if (this.firstLyric()) {
                    this.showLyricJumpNotification('第一句');
                }
            } else if (e.code === 'ArrowDown' && e.ctrlKey) {
                e.preventDefault();
                if (this.lastLyric()) {
                    this.showLyricJumpNotification('最后一句');
                }
            } else if (e.code === 'Escape') {
                this.toggleFullscreen();
            } else if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this.adjustFontSize(0.1);
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this.adjustFontSize(-0.1);
            } else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                this.switchTheme();
            } else if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                this.switchPlayMode();
            } else if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                document.getElementById('lyricsSearch').focus();
            } else if (e.key === '[') {
                e.preventDefault();
                this.adjustOffset(-0.1);
            } else if (e.key === ']') {
                e.preventDefault();
                this.adjustOffset(0.1);
            } else if (e.code.startsWith('Digit')) {
                const num = parseInt(e.code.replace('Digit', ''));
                if (num >= 1 && num <= 9) {
                    e.preventDefault();
                    this.switchToSong(num - 1);
                    // 数字键快速选歌后自动播放
                    const timerId = setTimeout(() => {
                        this.play();
                    }, 100);
                    this.addTimer(timerId);
                }
            }
        });
    }

    loadLrcFiles(files) {
        let loadedCount = 0;
        const totalFiles = files.length;

        files.forEach(file => {
            if (file.name.toLowerCase().endsWith('.lrc') || file.name.toLowerCase().endsWith('.txt')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const lyrics = this.parseLrc(e.target.result);
                        const song = {
                            name: file.name.replace(/\.[^/.]+$/, ""),
                            lyrics: lyrics,
                            duration: lyrics.length > 0 ? lyrics[lyrics.length - 1].time + 5 : 300, // 默认5分钟
                            mode: 'lyrics' // 纯歌词模式
                        };
                        this.addSong(song);

                        loadedCount++;
                        log(`歌曲 ${loadedCount}/${totalFiles} 加载完成:`, song.name);
                        if (this.showNotification) {
                            this.showNotification(`加载歌曲: ${song.name}`, 'success');
                        }
                    } catch (error) {
                        console.error('歌词解析错误:', file.name, error);
                        if (this.showNotification) {
                            this.showNotification(`歌词解析失败: ${file.name} - ${error.message}`, 'error');
                        }
                        loadedCount++;
                    }
                };
                reader.onerror = (error) => {
                    console.error('文件读取失败:', file.name, error);
                    if (this.showNotification) {
                        this.showNotification(`文件读取失败: ${file.name}`, 'error');
                    }
                    loadedCount++;
                };
                reader.readAsText(file, 'UTF-8');
            } else {
                warn('跳过非LRC文件:', file.name);
                loadedCount++;
            }
        });

        // 加载完成后自动排序
        const timerId = setTimeout(() => {
            this.sortPlaylist();
            this.updatePlaylist();
            this.showNotification('歌曲列表已自动排序', 'success');
        }, files.length * 20); // 根据文件数量调整延迟
        this.addTimer(timerId);
    }

    loadAudioFiles(files) {
        let loadedCount = 0;
        let matchedCount = 0;

        files.forEach(file => {
            const ext = file.name.toLowerCase().split('.').pop();
            if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'mp4'].includes(ext)) {
                loadedCount++;
                const fileName = file.name.replace(/\.[^/.]+$/, "");
                const matchedSong = this.findMatchingSong(fileName);

                if (matchedSong) {
                    matchedCount++;
                    // 关联音频文件
                    matchedSong.audioFile = file;
                    this.updateSongMode(matchedSong);
                    log(`音频文件 "${file.name}" 正在关联到歌曲 "${matchedSong.name}"`);

                    // --- 轻量级预加载以获取时长 ---
                    const tempAudio = new Audio();
                    const tempUrl = URL.createObjectURL(file);

                    tempAudio.addEventListener('loadedmetadata', () => {
                        log(`获取到 "${file.name}" 的精确时长: ${tempAudio.duration}`);
                        matchedSong.duration = tempAudio.duration;
                        // 销毁临时对象
                        tempAudio.src = '';
                        URL.revokeObjectURL(tempUrl);
                        // 时长更新后，刷新播放列表显示
                        this.updatePlaylist();
                    }, { once: true });

                    tempAudio.addEventListener('error', () => {
                        warn(`预加载 "${file.name}" 时长失败`);
                        URL.revokeObjectURL(tempUrl);
                    }, { once: true });

                    tempAudio.src = tempUrl;
                    // --- 预加载结束 ---

                } else {
                    warn(`音频文件 "${file.name}" 无法匹配到歌词文件，已跳过。`);
                    this.showNotification(`音频 "${file.name}" 未找到匹配的歌词`, 'warning');
                }
            }
        });

        if (loadedCount > 0) {
            this.showNotification(`处理了 ${loadedCount} 个音频文件，成功关联 ${matchedCount} 个`, 'info');
            const timerId = setTimeout(() => {
                this.sortPlaylist();
                this.updatePlaylist();
                this.showMatchingReport();
            }, 500); // 延迟以等待可能的元数据加载
            this.addTimer(timerId);
        }
    }
updateAudioMode() {
    const syncControls = document.getElementById('syncControls');

    if (this.currentSongIndex >= 0 && this.currentSongIndex < this.songs.length) {
        const currentSong = this.songs[this.currentSongIndex];
        const songMode = this.getSongMode(currentSong);

        switch (songMode) {
            case 'sync':
                this.currentSongStatus.textContent = '同步模式 (音频+歌词)';
                syncControls.style.display = 'block';
                this.updateOffsetDisplay();
                break;
            case 'audio':
                this.currentSongStatus.textContent = '纯音频模式';
                syncControls.style.display = 'none';
                break;
            case 'lyrics':
                this.currentSongStatus.textContent = '纯歌词模式 (手动控制)';
                syncControls.style.display = 'none';
                break;
            default:
                this.currentSongStatus.textContent = this.isPlaying ? '播放中' : '已暂停';
                syncControls.style.display = 'none';
        }
    } else {
        this.currentSongStatus.textContent = '准备播放';
        syncControls.style.display = 'none';
    }
}

syncWithAudio() {
    if (this.audioElement && this.audioMode) {
        this.currentTime = this.audioElement.currentTime + this.audioOffset;

        // 节流：限制歌词更新频率，减少 DOM 操作
        const now = performance.now();
        if (now - this.lastLyricsUpdate >= CONFIG.THROTTLE.LYRICS_UPDATE) {
            this.lastLyricsUpdate = now;
            requestAnimationFrame(() => {
                this.updateProgress();
                this.updateLyricsDisplay();
            });
        }
    }
}

loadBackgroundImage(file) {
    try {
        // 释放之前的背景图片URL
        const currentBg = this.backgroundContainer.style.backgroundImage;
        if (currentBg && currentBg.includes('blob:')) {
            const match = currentBg.match(/url\("?([^"\)]+)"?\)/);
            if (match && match[1]) {
                this.revokeObjectUrl(match[1]);
            }
        }

        // 使用 ObjectURL 替代 DataURL，减少内存占用
        const objectUrl = URL.createObjectURL(file);
        this.trackObjectUrl(objectUrl);
        this.backgroundContainer.style.backgroundImage = `url(${objectUrl})`;

        log('背景图片加载成功');
        this.showNotification(`背景图片加载成功: ${file.name}`, 'success');
    } catch (error) {
        console.error('背景图片处理错误:', error);
        this.showNotification('背景图片处理失败', 'error');
    }
}

parseLrc(lrcContent) {
    // 先校验参数，避免空值导致异常
    if (!lrcContent || typeof lrcContent !== 'string') {
        throw new Error('无效的歌词文件内容');
    }

    const lyrics = [];
    const lines = lrcContent.split('\n');

    lines.forEach((line, index) => {
        try {
            const match = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const centiseconds = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2)) : 0;
                const text = match[4].trim();

                if (isNaN(minutes) || isNaN(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) {
                    throw new Error(`第${index + 1}行时间格式错误: ${line}`);
                }

                const time = minutes * 60 + seconds + centiseconds / 100;
                lyrics.push({ time, text: text || '♪' });
            }
        } catch (error) {
            warn(`解析歌词第${index + 1}行失败:`, line, error.message);
        }
    });

    return lyrics.sort((a, b) => a.time - b.time);
}

addSong(song) {
    // 确保新歌曲有默认的userMode
    if (!song.userMode) {
        song.userMode = 'auto';
    }

    // 检查是否已存在同名歌曲，避免重复添加
    const existingSong = this.songs.find(s => s.name === song.name);
    if (existingSong) {
        warn(`歌曲 "${song.name}" 已存在，跳过重复添加`);
        return;
    }

    this.songs.push(song);
    log('歌曲添加到列表:', song.name, '总时长:', this.formatTime(song.duration));
    this.updatePlaylist();
    this.updateStatusIndicator();

    // 如果这是第一首歌，自动选中
    if (this.songs.length === 1) {
        this.switchToSong(0);
    }
}

updatePlaylist() {
    if (this.isPlaylistUpdatePending) return;
    this.isPlaylistUpdatePending = true;
    requestAnimationFrame(() => {
        this.renderPlaylist();
        this.isPlaylistUpdatePending = false;
    });
}

renderPlaylist() {
    const modeIcons = {
        'list': '📋',
        'loop': '🔁',
        'single': '🔂',
        'random': '🔀'
    };
    this.playlistCount.textContent = `${this.songs.length} 首歌曲 ${modeIcons[this.playMode]}`;

    if (this.songs.length === 0) {
        this.playlist.innerHTML = '<div class="empty-playlist">还没有歌曲，请上传LRC文件</div>';
        return;
    }

    // 使用DocumentFragment减少重排
    const fragment = document.createDocumentFragment();

    this.songs.forEach((song, index) => {
        const songItem = document.createElement('div');
        songItem.className = `song-item ${index === this.currentSongIndex ? 'current' : ''}`;
        songItem.dataset.index = index;

        // 获取歌曲模式并显示相应图标
        const songMode = this.getSongMode(song);
        const safeName = escapeHtml(song.name);
        let modeIcon = '';
        let modeTitle = '';
        switch (songMode) {
            case 'sync':
                modeIcon = '🎵';
                modeTitle = '同步模式 (音频+歌词)';
                break;
            case 'audio':
                modeIcon = '🎶';
                modeTitle = '纯音频模式';
                break;
            case 'lyrics':
                modeIcon = '📝';
                modeTitle = '纯歌词模式';
                break;
        }

        songItem.innerHTML = `
                <div class="drag-handle" title="拖拽排序">⋮⋮</div>
                <div class="song-index-num">${index + 1}</div>
                <div class="song-mode-icon" title="${modeTitle}" style="font-size: 10px; margin-right: 4px;">${modeIcon}</div>
                ${this.createModeSelector(song, index)}
                <div class="song-name" title="${safeName}">${safeName}</div>
                <div class="song-duration">${this.formatTime(song.duration)}</div>
                <div class="song-controls">
                    <button class="song-control-btn delete-btn" data-action="delete" data-index="${index}" title="删除">×</button>
                </div>
            `;

        // 设置模式属性，但不设置draggable，由拖拽手柄控制
        songItem.setAttribute('data-user-mode', song.userMode || 'auto');

        fragment.appendChild(songItem);
    });

    this.playlist.innerHTML = '';
    this.playlist.appendChild(fragment);

    // 添加事件监听器
    this.playlist.querySelectorAll('.song-item').forEach(item => {
        // 单击事件
        item.addEventListener('click', (e) => {
            // 如果点击的是删除按钮，不执行切换歌曲
            if (e.target.dataset.action === 'delete') {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                this.removeSong(index);
                return;
            }

            // 如果点击的是拖拽手柄或模式选择器，不执行切换歌曲
            if (e.target.classList.contains('drag-handle') ||
                e.target.classList.contains('mode-selector')) {
                e.stopPropagation();
                return;
            }

            const index = parseInt(item.dataset.index);
            this.switchToSong(index);
        });

        // 双击事件
        item.addEventListener('dblclick', (e) => {
            // 如果点击的是删除按钮、拖拽手柄或模式选择器，不执行播放
            if (e.target.dataset.action === 'delete' ||
                e.target.classList.contains('drag-handle') ||
                e.target.classList.contains('mode-selector')) {
                return;
            }

            const index = parseInt(item.dataset.index);
            this.switchToSong(index);
            const timerId = setTimeout(() => this.play(), 100);
            this.addTimer(timerId);
        });

        // 模式选择器变化事件
        const modeSelector = item.querySelector('.mode-selector');
        if (modeSelector) {
            modeSelector.addEventListener('change', (e) => {
                e.stopPropagation();
                const songIndex = parseInt(e.target.dataset.songIndex);
                const newMode = e.target.value;
                this.changeSongMode(songIndex, newMode);
            });
        }

        // 拖拽事件 - 初始化拖拽手柄
        const dragHandle = item.querySelector('.drag-handle');
        if (dragHandle) {
            this.initSongItemDragEvents(item, dragHandle);
        }
    });

    log('播放列表更新完成，共', this.songs.length, '首歌曲');
}

initSongItemDragEvents(item, dragHandle) {
    // 设置拖拽手柄为可拖拽
    dragHandle.draggable = true;

    // 拖拽开始事件 - 绑定到拖拽手柄
    dragHandle.addEventListener('dragstart', (e) => {
        this.draggedElement = item;
        item.classList.add('dragging');

        // 设置拖拽数据
        const dragIndex = parseInt(item.dataset.index);
        e.dataTransfer.setData('text/plain', dragIndex.toString());
        e.dataTransfer.effectAllowed = 'move';

        // 创建自定义拖拽图像
        const dragImage = item.cloneNode(true);
        dragImage.style.opacity = '0.8';
        dragImage.style.transform = 'rotate(2deg)';
        dragImage.style.width = item.offsetWidth + 'px';
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, item.offsetWidth / 2, 20);

        // 存储 dragImage 引用，在 dragend 时清理
        this.currentDragImage = dragImage;

        log('开始拖拽歌曲:', this.songs[dragIndex].name);
    });

    // 拖拽结束事件 - 绑定到拖拽手柄
    dragHandle.addEventListener('dragend', (e) => {
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
            this.draggedElement = null;
        }

        // 清理拖拽图像元素
        if (this.currentDragImage && document.body.contains(this.currentDragImage)) {
            document.body.removeChild(this.currentDragImage);
            this.currentDragImage = null;
        }

        // 清除所有拖拽相关样式
        this.playlist.querySelectorAll('.song-item').forEach(songItem => {
            songItem.classList.remove('drag-over');
            songItem.style.borderTop = '';
            songItem.style.borderBottom = '';
        });

        log('拖拽结束');
    });

    // 拖拽覆盖事件 - 绑定到歌曲项
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (item !== this.draggedElement) {
            // 清除其他项的样式
            this.playlist.querySelectorAll('.song-item').forEach(songItem => {
                if (songItem !== item) {
                    songItem.classList.remove('drag-over');
                    songItem.style.borderTop = '';
                    songItem.style.borderBottom = '';
                }
            });

            // 计算鼠标在元素中的位置，决定插入位置
            const rect = item.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const isTop = e.clientY < midpoint;

            // 更新视觉反馈
            item.classList.add('drag-over');
            if (isTop) {
                item.style.borderTop = '2px solid #007bff';
                item.style.borderBottom = '';
            } else {
                item.style.borderTop = '';
                item.style.borderBottom = '2px solid #007bff';
            }
        }
    });

    // 拖拽进入事件 - 绑定到歌曲项
    item.addEventListener('dragenter', (e) => {
        e.preventDefault();
    });

    // 拖拽离开事件 - 绑定到歌曲项
    item.addEventListener('dragleave', (e) => {
        // 只有当完全离开元素时才清除样式
        if (!item.contains(e.relatedTarget)) {
            item.classList.remove('drag-over');
            item.style.borderTop = '';
            item.style.borderBottom = '';
        }
    });

    // 放置事件 - 绑定到歌曲项
    item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        item.style.borderTop = '';
        item.style.borderBottom = '';

        if (item === this.draggedElement) return;

        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const dropIndex = parseInt(item.dataset.index);

        // 计算实际插入位置
        const rect = item.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const isTop = e.clientY < midpoint;
        const finalIndex = isTop ? dropIndex : dropIndex + 1;

        log(`拖拽: 从位置 ${dragIndex} 移动到位置 ${finalIndex}`);

        if (dragIndex !== finalIndex && finalIndex <= this.songs.length) {
            this.reorderSongs(dragIndex, Math.min(finalIndex, this.songs.length - 1));
        }
    });
}

reorderSongs(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;

    // 移动歌曲
    const movedSong = this.songs.splice(fromIndex, 1)[0];
    this.songs.splice(toIndex, 0, movedSong);

    // 更新当前播放索引
    if (this.currentSongIndex === fromIndex) {
        // 当前播放的歌曲被移动了
        this.currentSongIndex = toIndex;
    } else if (this.currentSongIndex > fromIndex && this.currentSongIndex <= toIndex) {
        // 当前播放的歌曲索引需要减1
        this.currentSongIndex--;
    } else if (this.currentSongIndex < fromIndex && this.currentSongIndex >= toIndex) {
        // 当前播放的歌曲索引需要加1
        this.currentSongIndex++;
    }

    // 更新显示
    this.updatePlaylist();
    this.updateSongDisplay();

    log(`歌曲从位置 ${fromIndex + 1} 移动到位置 ${toIndex + 1}`);
    this.showNotification(`歌曲已移动到第 ${toIndex + 1} 位`, 'success');
}

switchToSong(index) {
    if (index < 0 || index >= this.songs.length) return;

    // 1. 销毁上一首歌曲的音频资源
    const oldSong = this.songs[this.currentSongIndex];
    if (oldSong && oldSong.audioElement) {
        log('清理旧歌曲的音频资源:', oldSong.name);
        oldSong.audioElement.pause();
        oldSong.audioElement.src = ''; // 断开连接
        if (oldSong.audioElement._blobUrl) {
            this.revokeObjectUrl(oldSong.audioElement._blobUrl);
        }
        oldSong.audioElement = null; // 解除引用
    }

    this.pause(); // 确保播放状态和全局audioElement被重置

    // 2. 切换到新歌曲
    this.currentSongIndex = index;
    const newSong = this.songs[this.currentSongIndex];

    this.currentLyricIndex = -1;
    this.currentTime = 0;
    this.pausedTime = 0;
    this.lyricsCache.clear();

    if (this.playMode === 'random' && !this.playHistory.includes(index)) {
        this.playHistory.push(index);
    }
    this.clearSearch();

    const songMode = this.getSongMode(newSong);
    this.audioMode = (songMode === 'sync' || songMode === 'audio');

    // 3. 按需创建新歌曲的音频资源
    if (this.audioMode && newSong.audioFile && !newSong.audioElement) {
        log(`按需创建 "${newSong.name}" 的音频元素`);
        const audio = new Audio();
        const url = URL.createObjectURL(newSong.audioFile);
        this.objectUrls.add(url);
        audio._blobUrl = url; // 存储url以便后续销毁
        audio.src = url;

        newSong.audioElement = audio;
        this.audioElement = audio; // 更新全局音频元素引用

        audio.addEventListener('loadedmetadata', () => {
            log(`音频 "${newSong.name}" 元数据加载完成, 时长:`, this.formatTime(audio.duration));
            newSong.duration = audio.duration;
            this.totalTimeSpan.textContent = this.formatTime(newSong.duration);
            this.updatePlaylist(); // 时长变化，更新播放列表
            if (this.isPlaying) {
                audio.play().catch(e => console.error("Play interrupted by metadata load:", e));
            }
        });

        audio.addEventListener('error', (e) => {
            console.error('音频文件加载失败:', e);
            this.showNotification(`音频加载失败: ${newSong.name}`, 'error');
            newSong.mode = 'lyrics'; // 降级为纯歌词模式
            this.updatePlaylist();
        });

        audio.addEventListener('timeupdate', () => {
            if (this.audioMode && this.isPlaying && this.audioElement === audio) {
                this.syncWithAudio();
            }
        });

        audio.addEventListener('ended', () => {
            if (this.audioElement === audio) {
                this.onSongEnded();
            }
        });
    } else if (this.audioMode) {
        this.audioElement = newSong.audioElement; // 如果已存在，直接引用
    } else {
        this.audioElement = null;
    }

    // 4. 更新UI
    this.updateSongDisplay();
    this.updatePlaylist();
    this.updateLyricsDisplay();
    this.progressBar.style.width = '0%';
    this.updateProgress();
    this.updateAudioMode();

    if (songMode === 'audio') {
        this.showLyrics('♪ 音频准备播放 ♪', '');
    } else if (newSong.lyrics && newSong.lyrics.length > 0) {
        this.showLyrics(newSong.lyrics[0].text,
            newSong.lyrics.length > 1 ? newSong.lyrics[1].text : '');
    } else {
        this.showLyrics('♪', '');
    }

    this.playButton.disabled = false;
    this.totalTimeSpan.textContent = this.formatTime(newSong.duration);
    log('切换到歌曲:', newSong.name, `(${songMode}模式)`);
}

switchToNextSong() {
    if (this.currentSongIndex < this.songs.length - 1) {
        this.switchToSong(this.currentSongIndex + 1);
        // 切换歌曲后自动播放
        const timerId = setTimeout(() => {
            this.play();
        }, 100);
        this.addTimer(timerId);
    }
}

onSongEnded() {
    this.pause();
    log('歌曲播放完成:', this.songs[this.currentSongIndex].name);

    // 根据播放模式决定下一步动作
    const nextIndex = this.getNextSongIndex();

    if (nextIndex >= 0) {
        log(`播放模式: ${this.playMode}, 准备播放下一首`);
        const timerId = setTimeout(() => {
            if (nextIndex === this.currentSongIndex && this.playMode === 'single') {
                // 单曲循环：重置到开头继续播放
                this.setCurrentTime(0);
                this.play();
            } else {
                // 切换到下一首歌曲
                this.switchToSong(nextIndex);
                const playTimerId = setTimeout(() => {
                    this.play();
                }, 100);
                this.addTimer(playTimerId);
            }
        }, 500); // 延迟500ms，让用户看到当前歌曲已完成
        this.addTimer(timerId);
    } else {
        log('播放列表已结束');
        this.showNotification('播放列表已结束', 'info');
    }
}

switchToPreviousSong() {
    if (this.currentSongIndex > 0) {
        this.switchToSong(this.currentSongIndex - 1);
        // 切换歌曲后自动播放
        const timerId = setTimeout(() => {
            this.play();
        }, 100);
        this.addTimer(timerId);
    }
}

removeSong(index) {
    if (index < 0 || index >= this.songs.length) return;

    const songToRemove = this.songs[index];
    log('删除歌曲:', songToRemove.name);

    // 如果删除的歌曲有关联的音频元素，清理它
    if (songToRemove.audioElement) {
        log('清理被删除歌曲的音频资源:', songToRemove.name);
        songToRemove.audioElement.pause();
        songToRemove.audioElement.src = '';
        if (songToRemove.audioElement._blobUrl) {
            this.revokeObjectUrl(songToRemove.audioElement._blobUrl);
        }
        songToRemove.audioElement = null;
    }

    // 如果删除的是当前播放的歌曲
    if (index === this.currentSongIndex) {
        this.pause();
        this.currentSongIndex = -1;
        this.showLyrics('♪', '');
        this.updateSongDisplay();
        this.playButton.disabled = true;
    } else if (index < this.currentSongIndex) {
        // 如果删除的歌曲在当前歌曲之前，调整索引
        this.currentSongIndex--;
    }

    // 从数组中删除歌曲
    this.songs.splice(index, 1);

    // 更新播放列表
    this.updatePlaylist();
    this.updateStatusIndicator();

    // 如果没有歌曲了
    if (this.songs.length === 0) {
        this.currentSongIndex = -1;
        this.showLyrics('请上传LRC歌词文件', '开始你的演出');
        this.songInfo.style.display = 'none';
        this.currentSongInfo.style.display = 'none';
        this.playButton.disabled = true;
    }
}

updateSongDisplay() {
    if (this.currentSongIndex >= 0 && this.currentSongIndex < this.songs.length) {
        const currentSong = this.songs[this.currentSongIndex];

        // 更新顶部显示（隐藏数字前缀）
        this.displaySongTitle.textContent = this.formatSongNameForDisplay(currentSong.name);
        this.displaySongIndex.textContent = `${this.currentSongIndex + 1} / ${this.songs.length}`;
        this.songInfo.style.display = 'block';

        // 更新控制面板显示（隐藏数字前缀）
        this.currentSongName.textContent = this.formatSongNameForDisplay(currentSong.name);
        this.currentSongStatus.textContent = this.isPlaying ? '播放中' : '已暂停';
        this.currentSongInfo.style.display = 'block';
    } else {
        this.songInfo.style.display = 'none';
        this.currentSongInfo.style.display = 'none';
    }
}

updateStatusIndicator() {
    if (this.songs.length === 0) {
        this.statusIndicator.className = 'status-indicator';
    } else if (this.isPlaying) {
        this.statusIndicator.className = 'status-indicator playing';
    } else {
        this.statusIndicator.className = 'status-indicator ready';
    }
}

showLyrics(current, next = '') {
    // 避免不必要的DOM更新
    if (this.currentLyricEl.textContent !== current) {
        // 使用 requestAnimationFrame 批量更新DOM，减少重排
        requestAnimationFrame(() => {
            this.currentLyricEl.textContent = current;
            this.nextLyricEl.textContent = next;

            // 添加入场动画 - 使用双重 rAF 确保动画正常执行
            this.currentLyricEl.classList.remove('entering');
            requestAnimationFrame(() => {
                this.currentLyricEl.classList.add('entering');
            });
        });
    }
}

togglePlay() {
    if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) {
        log('没有选择有效歌曲');
        return;
    }

    if (this.isPlaying) {
        this.pause();
    } else {
        this.play();
    }
}

play() {
    if (this.currentSongIndex < 0) {
        this.showNotification('请先选择一首歌曲', 'warning');
        return;
    }

    const currentSong = this.songs[this.currentSongIndex];
    const songMode = this.getSongMode(currentSong);

    const startPlayback = () => {
        // 如果播放完成，重置到开头
        const maxDuration = this.audioElement ? this.audioElement.duration : currentSong.duration;
        if (this.currentTime >= maxDuration) {
            this.currentTime = 0;
            this.pausedTime = 0;
        }

        this.isPlaying = true;
        this.playButton.textContent = '⏸';

        if (this.audioMode && this.audioElement) {
            this.audioElement.currentTime = Math.max(0, this.currentTime - this.audioOffset);
            this.audioElement.playbackRate = this.playbackSpeed;
            this.audioElement.play().catch(e => {
                console.error('音频播放失败:', e);
                this.showNotification('音频播放失败，请检查文件或浏览器权限', 'error');
                this.pause(); // 播放失败则回到暂停状态
            });
            if (songMode === 'audio') {
                this.showLyrics('♪ 音乐播放中 ♪', '');
            }
        } else { // 纯歌词模式
            this.startTime = performance.now() - (this.pausedTime * 1000);
            this.animate();
        }

        this.updateStatusIndicator();
        this.updateSongDisplay();
        this.requestWakeLock();
        log('开始播放:', currentSong.name, `(${songMode}模式)`);
    };

    if (this.audioMode && this.audioElement && this.audioElement.readyState < 2) {
        log('音频仍在加载中，等待 "canplay" 事件...');
        this.audioElement.addEventListener('canplay', startPlayback, { once: true });
    } else {
        startPlayback();
    }
}

pause() {
    if (!this.isPlaying) return; // 避免重复暂停

    this.isPlaying = false;
    this.playButton.textContent = '▶';

    if (this.audioElement) {
        this.pausedTime = this.audioElement.currentTime;
        this.audioElement.pause();
    } else {
        this.pausedTime = this.currentTime;
    }

    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
    }

    this.updateStatusIndicator();
    this.updateSongDisplay();
    this.releaseWakeLock();
    log('暂停播放');
}
animate() {
    if (!this.isPlaying) return;

    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    this.currentTime = elapsed * this.playbackSpeed;

    // 音频模式由 'timeupdate' 事件驱动，这里只处理纯歌词模式
    if (this.audioMode) {
        this.animationId = null;
        return;
    }

    // 节流更新进度条 (每100ms)
    if (now - this.lastProgressUpdate >= 100) {
        this.updateProgress();
        this.lastProgressUpdate = now;
    }

    // 节流更新歌词 (使用配置的频率)
    if (now - this.lastLyricsUpdate >= CONFIG.THROTTLE.LYRICS_UPDATE) {
        this.updateLyricsDisplay();
        this.lastLyricsUpdate = now;
    }

    // 继续循环
    this.animationId = requestAnimationFrame(() => this.animate());
}

seek(seconds) {
    if (this.currentSongIndex < 0) return;

    const currentSong = this.songs[this.currentSongIndex];
    const maxDuration = this.audioMode && this.audioElement ? this.audioElement.duration : currentSong.duration;

    // 限制在有效范围内
    let newTime = Math.max(0, Math.min(this.currentTime + seconds, maxDuration));

    this.setCurrentTime(newTime);
    this.showNotification(`${seconds > 0 ? '快进' : '快退'} ${Math.abs(seconds)}秒`, 'info', 1000);
}

setCurrentTime(time) {
    this.currentTime = time;
    this.startTime = performance.now() - (time / this.playbackSpeed * 1000); // 调整起始时间
    this.pausedTime = time; // 更新暂停时间点

    if (this.audioMode && this.audioElement) {
        this.audioElement.currentTime = Math.max(0, time - this.audioOffset);
    }

    this.updateProgress();
    this.updateLyricsDisplay();
}

seekTo(event) {
    if (this.currentSongIndex < 0) return;

    const rect = this.progressContainer.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const width = rect.width;

    if (width > 0) {
        const percentage = Math.max(0, Math.min(clickX / width, 1));
        const currentSong = this.songs[this.currentSongIndex];
        const maxDuration = this.audioMode && this.audioElement ? this.audioElement.duration : currentSong.duration;

        this.setCurrentTime(percentage * maxDuration);
        log('跳转进度到:', Math.round(percentage * 100) + '%');
    }
}

setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;

    if (this.audioMode && this.audioElement) {
        this.audioElement.playbackRate = speed;
    }

    // 更新startTime以保持进度正确
    if (this.isPlaying && !this.audioMode) {
        this.startTime = performance.now() - (this.currentTime / speed * 1000);
    }

    // 更新UI
    document.querySelectorAll('.speed-button').forEach(btn => {
        if (Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.01) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    this.showNotification(`播放速度: ${speed}x`, 'info');
    log('播放速度设置为:', speed);
}

setFontScale(scale) {
    this.fontScale = scale;
    document.documentElement.style.setProperty('--font-scale', scale);

    // 更新UI
    document.querySelectorAll('.font-size-button').forEach(btn => {
        if (Math.abs(parseFloat(btn.dataset.fontSize) - scale) < 0.01) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    log('字体比例设置为:', scale);
}

adjustFontSize(delta) {
    const newScale = Math.max(0.5, Math.min(3.0, this.fontScale + delta));
    this.setFontScale(Math.round(newScale * 10) / 10);
    this.saveSettings();
    this.showNotification(`字体大小: ${this.fontScale}`, 'info', 1000);
}

setTheme(themeName) {
    if (this.currentTheme === themeName) return;

    document.body.classList.remove(`theme-${this.currentTheme}`);
    this.currentTheme = themeName;
    document.body.classList.add(`theme-${themeName}`);

    // 更新UI
    document.querySelectorAll('.theme-button').forEach(btn => {
        if (btn.dataset.theme === themeName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    this.showNotification(`主题切换: ${this.getThemeName(themeName)}`, 'info');
    log('主题切换为:', themeName);
}

getThemeName(theme) {
    const names = {
        'classic': '经典白',
        'gold': '流金岁月',
        'blue': '赛博蓝',
        'rainbow': '炫彩霓虹'
    };
    return names[theme] || theme;
}

switchTheme() {
    const themes = ['classic', 'gold', 'blue', 'rainbow'];
    const currentIndex = themes.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.setTheme(themes[nextIndex]);
    this.saveSettings();
}

setPlayMode(mode) {
    this.playMode = mode;

    // 更新UI
    document.querySelectorAll('.play-mode-button').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 获取显示名称
    let modeName = '';
    switch (mode) {
        case 'list': modeName = '列表播放'; break;
        case 'loop': modeName = '列表循环'; break;
        case 'single': modeName = '单曲循环'; break;
        case 'random': modeName = '随机播放'; break;
    }

    // 更新播放列表头部的图标
    this.updatePlaylist();

    this.showNotification(`播放模式: ${modeName}`, 'info');
    log('播放模式设置为:', modeName);
}

switchPlayMode() {
    const modes = ['list', 'loop', 'single', 'random'];
    const currentIndex = modes.indexOf(this.playMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.setPlayMode(modes[nextIndex]);
    this.saveSettings();
}

getNextSongIndex() {
    if (this.songs.length === 0) return -1;

    switch (this.playMode) {
        case 'list':
            return this.currentSongIndex < this.songs.length - 1 ? this.currentSongIndex + 1 : -1;

        case 'loop':
            return (this.currentSongIndex + 1) % this.songs.length;

        case 'single':
            return this.currentSongIndex;

        case 'random':
            if (this.playHistory.length >= this.songs.length) {
                this.playHistory = []; // 重置历史
            }

            let nextIndex;
            let attempts = 0;
            do {
                nextIndex = Math.floor(Math.random() * this.songs.length);
                attempts++;
            } while (
                (nextIndex === this.currentSongIndex || this.playHistory.includes(nextIndex)) &&
                attempts < 20 // 避免死循环
            );

            this.playHistory.push(nextIndex);
            return nextIndex;

        default:
            return (this.currentSongIndex + 1) % this.songs.length;
    }
}

searchLyrics(query) {
    const searchResultsContainer = document.getElementById('searchResults');

    if (!query || query.trim() === '') {
        this.clearSearch();
        return;
    }

    if (this.currentSongIndex < 0) {
        this.showNotification('请先选择一首歌曲', 'warning');
        return;
    }

    const currentSong = this.songs[this.currentSongIndex];
    const lyrics = currentSong.lyrics;

    this.searchResults = lyrics.filter(line =>
        line.text.toLowerCase().includes(query.toLowerCase())
    );

    this.displaySearchResults(this.searchResults, query);
}

displaySearchResults(results, query) {
    const searchResultsContainer = document.getElementById('searchResults');
    searchResultsContainer.innerHTML = '';

    if (results.length === 0) {
        searchResultsContainer.style.display = 'none';
        return;
    }

    searchResultsContainer.style.display = 'block';

    results.forEach(line => {
        const item = document.createElement('div');
        item.className = 'search-result-item';

        const timeStr = this.formatTime(line.time);

        // 高亮匹配文本
        const highlightedText = highlightText(line.text, query);

        item.innerHTML = `
                <span class="search-result-time">[${timeStr}]</span>
                <span>${highlightedText}</span>
            `;

        item.addEventListener('click', () => {
            this.setCurrentTime(line.time);
            // 找到该歌词的索引并设置
            const index = this.songs[this.currentSongIndex].lyrics.indexOf(line);
            if (index !== -1) {
                this.currentLyricIndex = index;
                this.lastLyricSearchIndex = index;
                this.updateLyricsDisplay();
            }

            if (!this.isPlaying) {
                this.play();
            }

            searchResultsContainer.style.display = 'none';
        });

        searchResultsContainer.appendChild(item);
    });
}

clearSearch() {
    const searchResultsContainer = document.getElementById('searchResults');
    if (searchResultsContainer) {
        searchResultsContainer.innerHTML = '';
        searchResultsContainer.style.display = 'none';
        this.searchResults = [];
    }
}

addTimer(timerId) {
    this.timers.add(timerId);
}

setTimer(callback, delay) {
    const timerId = setTimeout(() => {
        // 执行回调
        callback();
        // 执行完后从集合中移除，防止内存泄漏
        this.timers.delete(timerId);
    }, delay);
    this.timers.add(timerId);
    return timerId;
}

clearTimer(timerId) {
    if (this.timers.has(timerId)) {
        clearTimeout(timerId);
        this.timers.delete(timerId);
    }
}

cleanup() {
    log('清理资源...');

    // 清理动画帧
    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
    }

    // 清理音频资源
    if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.src = '';
    }

    // 清理所有URL对象
    this.objectUrls.forEach(url => {
        try {
            URL.revokeObjectURL(url);
        } catch (error) {
            warn('释放对象URL时出错:', url, error);
        }
    });
    this.objectUrls.clear();

    // 清理定时器（包括光标定时器）
    if (this.cursorTimeout) {
        clearTimeout(this.cursorTimeout);
        this.cursorTimeout = null;
    }
    this.timers.forEach(timerId => {
        clearTimeout(timerId);
    });
    this.timers.clear();

    // 清理事件监听器
    this.eventListeners.forEach((handler, eventType) => {
        try {
            document.removeEventListener(eventType, handler);
        } catch (error) {
            warn('移除事件监听器时出错:', eventType, error);
        }
    });
    this.eventListeners.clear();

    // 清理增强的事件监听器注册表
    this.removeAllEventListeners();

    // 清理缓存
    this.lyricsCache.clear();
    this.searchResults = [];

    // 释放屏幕唤醒锁
    this.releaseWakeLock();

    log('资源清理完成');
}

// 通知系统
showNotification(message, type = 'info', duration = 3000) {
    try {
        const container = document.getElementById('notificationContainer');
        if (!container) {
            console.error('通知容器不存在');
            return;
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        // 自动移除
        const timerId = setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, duration);
        this.addTimer(timerId);

        // 点击关闭
        notification.addEventListener('click', () => {
            this.clearTimer(timerId);
            if (notification.parentNode) {
                notification.style.animation = 'fadeOut 0.2s ease forwards';
                const fadeTimerId = setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 200);
                this.addTimer(fadeTimerId);
            }
        });
    } catch (error) {
        console.error('显示通知时出错:', error);
        // 降级处理：直接在控制台输出
        log(`[${type.toUpperCase()}] ${message}`);
    }
}

updateProgress() {
    if (this.currentSongIndex < 0) return;

    const currentSong = this.songs[this.currentSongIndex];
    const maxDuration = this.audioMode && this.audioElement ? this.audioElement.duration : currentSong.duration;

    // 处理无效时长的情况
    if (!maxDuration || maxDuration <= 0 || isNaN(maxDuration)) {
        this.progressBar.style.width = '0%';
        this.currentTimeSpan.textContent = this.formatTime(this.currentTime);
        this.totalTimeSpan.textContent = '0:00';
        return;
    }

    const progress = (this.currentTime / maxDuration) * 100;
    const progressPercent = Math.max(0, Math.min(progress, 100));

    // 直接设置width而不是使用transform
    this.progressBar.style.width = `${progressPercent}%`;
    this.currentTimeSpan.textContent = this.formatTime(this.currentTime);
    this.totalTimeSpan.textContent = this.formatTime(maxDuration);
}

updateLyricsDisplay() {
    if (this.currentSongIndex < 0) return;

    const currentSong = this.songs[this.currentSongIndex];
    const lyrics = currentSong.lyrics;

    if (!lyrics || lyrics.length === 0) {
        this.showLyrics('无歌词', '');
        return;
    }

    // 优化：如果时间倒退（用户拖动进度条回退），重置搜索起始点
    if (this.currentTime < this.lastLyricSearchTime) {
        this.lastLyricSearchIndex = 0;
    }
    this.lastLyricSearchTime = this.currentTime;

    // 优化：从上次的位置开始向后查找，而不是每次都从头遍历 (O(1) vs O(N))
    let activeIndex = -1;
    // 只有当当前时间大于第一句歌词时间才开始查找
    if (this.currentTime >= lyrics[0].time) {
        // 从上次索引开始，快速找到当前应该显示的歌词
        for (let i = this.lastLyricSearchIndex; i < lyrics.length; i++) {
            if (this.currentTime >= lyrics[i].time) {
                // 这是一个候选，但我们要看下一句是否也已经到了
                if (i === lyrics.length - 1 || this.currentTime < lyrics[i + 1].time) {
                    activeIndex = i;
                    this.lastLyricSearchIndex = i; // 更新搜索起点
                    break;
                }
            } else {
                // 如果当前句的时间都已经大于当前时间，那后面的肯定也大于，直接跳出
                break;
            }
        }
    }

    // 只有当歌词索引发生变化时才更新 DOM
    if (activeIndex !== this.currentLyricIndex) {
        this.currentLyricIndex = activeIndex;

        const currentLyric = activeIndex >= 0 ? lyrics[activeIndex].text : '...';
        const nextLyric = activeIndex >= 0 && activeIndex < lyrics.length - 1
            ? lyrics[activeIndex + 1].text
            : '';

        this.showLyrics(currentLyric, nextLyric);
        // 更新进度指示器
        this.updateLyricProgress();
    }
}

toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            log('无法进入全屏模式:', err);
        });
    } else {
        document.exitFullscreen().catch(err => {
            log('无法退出全屏模式:', err);
        });
    }
}

formatTime(seconds) {
    return formatTimeUtil(seconds);
}

// 播放列表管理
sortPlaylist() {
    if (this.songs.length <= 1) {
        this.showNotification('歌曲数量不足，无需排序', 'info');
        return;
    }

    // 记录当前播放歌曲的名称
    const currentSongName = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex].name : null;

    // 智能排序：数字前缀优先，然后按名称
    this.songs.sort((a, b) => {
        const nameA = a.name;
        const nameB = b.name;

        // 提取数字前缀
        const extractNumber = (name) => {
            const match = name.match(/^(\d+)/);
            return match ? parseInt(match[1]) : Infinity;
        };

        const numA = extractNumber(nameA);
        const numB = extractNumber(nameB);

        // 如果都有数字前缀，按数字排序
        if (numA !== Infinity && numB !== Infinity) {
            if (numA !== numB) return numA - numB;
            // 数字相同时按名称排序
            return nameA.localeCompare(nameB, 'zh-CN');
        }

        // 如果只有一个有数字前缀，有数字的排在前面
        if (numA !== Infinity) return -1;
        if (numB !== Infinity) return 1;

        // 都没有数字前缀，按名称排序
        return nameA.localeCompare(nameB, 'zh-CN');
    });

    // 重新找到当前播放歌曲的索引
    if (currentSongName) {
        this.currentSongIndex = this.songs.findIndex(song => song.name === currentSongName);
    }

    // 更新显示
    this.updatePlaylist();
    this.updateSongDisplay();

    this.showNotification(`歌曲列表已按名称排序 (${this.songs.length} 首)`, 'success');
    log('播放列表已排序');
}

exportPlaylist() {
    if (this.songs.length === 0) {
        this.showNotification('播放列表为空，无法导出', 'warning');
        return;
    }

    const playlistData = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        songs: this.songs.map(song => ({
            name: song.name,
            lyrics: song.lyrics,
            duration: song.duration
        }))
    };

    const dataStr = JSON.stringify(playlistData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    this.objectUrls.add(url);

    const link = document.createElement('a');
    link.href = url;
    link.download = `歌词播放列表_${new Date().toLocaleDateString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showNotification(`已导出 ${this.songs.length} 首歌曲的播放列表`, 'success');
}

importPlaylist(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const playlistData = JSON.parse(e.target.result);

            if (!playlistData.songs || !Array.isArray(playlistData.songs)) {
                throw new Error('无效的播放列表格式');
            }

            // 验证歌曲数据
            const validSongs = playlistData.songs.filter(song => {
                return song.name && song.lyrics && Array.isArray(song.lyrics);
            });

            if (validSongs.length === 0) {
                throw new Error('播放列表中没有有效的歌曲数据');
            }

            // 清空当前播放列表
            this.clearPlaylist(true); // 使用force=true来避免确认提示

            // 添加导入的歌曲
            validSongs.forEach(songData => {
                this.addSong({
                    name: songData.name,
                    lyrics: songData.lyrics,
                    duration: songData.duration || 0
                });
            });

            this.showNotification(`成功导入 ${validSongs.length} 首歌曲`, 'success');

        } catch (error) {
            console.error('导入播放列表失败:', error);
            this.showNotification(`导入失败: ${error.message}`, 'error');
        }
    };

    reader.onerror = () => {
        this.showNotification('文件读取失败', 'error');
    };

    reader.readAsText(file, 'UTF-8');
}

clearPlaylist(force = false) {
    if (this.songs.length === 0) {
        if (!force) this.showNotification('播放列表已经为空', 'info');
        return;
    }

    if (force || confirm(`确定要清空所有 ${this.songs.length} 首歌曲吗？`)) {
        this.pause();
        // 清理所有歌曲的音频资源
        this.songs.forEach(song => {
            if (song.audioElement) {
                song.audioElement.pause();
                song.audioElement.src = '';
                if (song.audioElement._blobUrl) {
                    this.revokeObjectUrl(song.audioElement._blobUrl);
                }
            }
        });

        this.songs = [];
        this.currentSongIndex = -1;
        this.updatePlaylist();
        this.updateStatusIndicator();
        this.showLyrics('请上传LRC歌词文件', '开始你的演出');
        this.songInfo.style.display = 'none';
        this.currentSongInfo.style.display = 'none';
        this.playButton.disabled = true;
        if (!force) this.showNotification('播放列表已清空', 'success');
    }
}
// 同步校准功能
adjustOffset(delta) {
    if (!this.audioMode) {
        this.showNotification('仅在音频同步模式下可用', 'warning');
        return;
    }

    this.audioOffset += delta;
    this.audioOffset = Math.round(this.audioOffset * 10) / 10; // 保留一位小数
    this.updateOffsetDisplay();

    log('音频偏移调整为:', this.audioOffset, '秒');
}

resetOffset() {
    if (!this.audioMode) {
        this.showNotification('仅在音频同步模式下可用', 'warning');
        return;
    }

    this.audioOffset = 0;
    this.updateOffsetDisplay();
    this.showNotification('同步偏移已重置', 'success');
}

updateOffsetDisplay() {
    const offsetDisplay = document.getElementById('offsetDisplay');
    if (offsetDisplay) {
        const sign = this.audioOffset >= 0 ? '+' : '';
        offsetDisplay.textContent = `${sign}${this.audioOffset.toFixed(1)}s`;
    }
}

// 文件匹配和播放模式管理
findMatchingSong(fileName) {
    // 首先尝试精确匹配
    let matchedSong = this.songs.find(song => song.name === fileName);
    if (matchedSong) {
        log(`精确匹配成功: "${fileName}" ← "${matchedSong.name}"`);
        return matchedSong;
    }

    // 智能模糊匹配 - 寻找最佳匹配而不是第一个匹配
    return this.findBestMatch(fileName);
}

// 寻找最佳匹配的歌曲
findBestMatch(fileName) {
    const candidates = [];

    // 为每首歌曲计算匹配分数
    this.songs.forEach(song => {
        const score = this.calculateMatchScore(song.name, fileName);
        if (score > 0) {
            candidates.push({
                song: song,
                score: score,
                details: this.getMatchDetails(song.name, fileName)
            });
        }
    });

    // 按分数排序，选择最高分
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
        const bestMatch = candidates[0];

        // 只有分数足够高才认为是有效匹配
        if (bestMatch.score >= 0.7) { // 降低匹配阈值到70%以提高匹配成功率
            log(`智能匹配成功: "${fileName}" ← "${bestMatch.song.name}" (分数: ${bestMatch.score.toFixed(3)}, ${bestMatch.details})`);

            // 显示其他候选项（用于调试）
            if (candidates.length > 1) {
                log('其他候选匹配:', candidates.slice(1, 3).map(c =>
                    `"${c.song.name}" (${c.score.toFixed(3)})`
                ).join(', '));
            }

            return bestMatch.song;
        } else {
            log(`匹配分数过低: "${fileName}", 最佳候选 "${bestMatch.song.name}" (分数: ${bestMatch.score.toFixed(3)})`);
        }
    }

    log(`未找到匹配: "${fileName}"`);
    return null;
}

// 计算匹配分数 (0-1之间)
calculateMatchScore(songName, targetName) {
    // 多重匹配策略，取最高分
    const scores = [];

    // 1. 精确匹配（去除扩展名）
    const songBase = songName.replace(/\.[^/.]+$/, '');
    const targetBase = targetName.replace(/\.[^/.]+$/, '');
    if (songBase === targetBase) {
        return 1.0; // 完美匹配
    }

    // 2. 标准化后的精确匹配
    const normalizedSong = this.normalizeForMatching(songName);
    const normalizedTarget = this.normalizeForMatching(targetName);
    if (normalizedSong === normalizedTarget && normalizedSong.length > 2) {
        scores.push(0.95);
    }

    // 3. 编辑距离相似度
    const similarity = this.calculateSimilarity(normalizedSong, normalizedTarget);
    scores.push(similarity);

    // 4. 数字前缀匹配（如果都有数字前缀）
    const songPrefix = songName.match(/^(\d+)/);
    const targetPrefix = targetName.match(/^(\d+)/);
    if (songPrefix && targetPrefix && songPrefix[1] === targetPrefix[1]) {
        // 相同数字前缀，增加权重
        const nameWithoutPrefix1 = songName.replace(/^\d+[-_\s]*/, '');
        const nameWithoutPrefix2 = targetName.replace(/^\d+[-_\s]*/, '');
        const prefixSimilarity = this.calculateSimilarity(
            this.normalizeForMatching(nameWithoutPrefix1),
            this.normalizeForMatching(nameWithoutPrefix2)
        );
        scores.push(prefixSimilarity * 0.98); // 略低于完美匹配
    }

    // 5. 长度惩罚：长度差异很大的匹配降低分数
    const lengthRatio = Math.min(normalizedSong.length, normalizedTarget.length) /
        Math.max(normalizedSong.length, normalizedTarget.length);
    const lengthPenalty = lengthRatio < 0.5 ? 0.8 : 1.0; // 长度差异大于2倍时惩罚

    // 边界检查：如果没有有效分数，返回0
    if (scores.length === 0) {
        return 0;
    }

    const maxScore = Math.max(...scores);
    return maxScore * lengthPenalty;
}

// 获取匹配详情（用于调试）
getMatchDetails(songName, targetName) {
    const details = [];

    if (songName.replace(/\.[^/.]+$/, '') === targetName.replace(/\.[^/.]+$/, '')) {
        details.push('精确匹配');
    } else {
        const normalizedSong = this.normalizeForMatching(songName);
        const normalizedTarget = this.normalizeForMatching(targetName);

        if (normalizedSong === normalizedTarget) {
            details.push('标准化后匹配');
        } else {
            const similarity = this.calculateSimilarity(normalizedSong, normalizedTarget);
            details.push(`相似度${Math.round(similarity * 100)}%`);
        }

        const songPrefix = songName.match(/^(\d+)/);
        const targetPrefix = targetName.match(/^(\d+)/);
        if (songPrefix && targetPrefix && songPrefix[1] === targetPrefix[1]) {
            details.push(`数字前缀${songPrefix[1]}`);
        }
    }

    return details.join(', ');
}

// 标准化文件名用于匹配
normalizeForMatching(name) {
    return name
        .replace(/\.[^.]*$/, '') // 去除扩展名
        .replace(/^\d+[-_\s]*/, '') // 去除数字前缀 (如 "01_", "1-", "001 ")
        .replace(/[-_\s]+/g, '') // 去除连字符、下划线、空格
        .toLowerCase() // 转小写
        .trim();
}

// 格式化歌曲名称用于主页面显示（去除数字前缀和下划线）
formatSongNameForDisplay(name) {
    return name
        .replace(/\.[^.]*$/, '') // 去除扩展名
        .replace(/^\d+[-_\s]*/, '') // 去除数字前缀 (如 "01_", "1-", "001 ")
        .trim();
}

fuzzyMatch(songName, targetName) {
    // 使用新的匹配分数系统
    const score = this.calculateMatchScore(songName, targetName);
    return score >= 0.85; // 85%以上相似度认为匹配
}

calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    const maxLength = Math.max(str1.length, str2.length);
    const editDistance = this.levenshteinDistance(str1, str2);
    return (maxLength - editDistance) / maxLength;
}

levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

// 获取歌曲可用的播放模式
getAvailableModes(song) {
    const modes = [];

    if (song.lyrics && song.lyrics.length > 0) {
        modes.push('lyrics');
    }

    if (song.audioFile && song.audioElement) {
        modes.push('audio');

        // 只有同时有歌词和音频才能同步
        if (song.lyrics && song.lyrics.length > 0) {
            modes.push('sync');
        }
    }

    return modes;
}

// 获取歌曲的实际播放模式（用户选择 + 智能回退）
getEffectiveMode(song) {
    const userMode = song.userMode || 'auto';
    const availableModes = this.getAvailableModes(song);

    if (userMode === 'auto') {
        return this.getAutoDetectedMode(song);
    }

    // 检查用户选择的模式是否可用
    if (availableModes.includes(userMode)) {
        return userMode;
    }

    // 回退到自动模式
    return this.getAutoDetectedMode(song);
}

// 自动检测模式（原getSongMode逻辑）
getAutoDetectedMode(song) {
    if (song.audioFile && song.lyrics && song.lyrics.length > 0) return 'sync';
    if (song.audioFile) return 'audio';
    return 'lyrics';
}

getSongMode(song) {
    // 保持向后兼容，使用新的getEffectiveMode
    return this.getEffectiveMode(song);
}

updateSongMode(song) {
    song.mode = this.getSongMode(song);
    return song.mode;
}

// 创建模式选择器HTML
createModeSelector(song, index) {
    const availableModes = this.getAvailableModes(song);
    const currentUserMode = song.userMode || 'auto';

    const modeOptions = {
        'auto': { icon: '🔄', label: '自动', available: true },
        'lyrics': { icon: '📝', label: '歌词', available: availableModes.includes('lyrics') },
        'audio': { icon: '🎵', label: '音频', available: availableModes.includes('audio') },
        'sync': { icon: '🎶', label: '同步', available: availableModes.includes('sync') }
    };

    let selectorHTML = `<select class="mode-selector" data-song-index="${index}">`;

    for (const [mode, config] of Object.entries(modeOptions)) {
        if (config.available) {
            const selected = mode === currentUserMode ? 'selected' : '';
            selectorHTML += `<option value="${mode}" ${selected}>${config.icon}</option>`;
        }
    }

    selectorHTML += `</select>`;
    return selectorHTML;
}

// 获取模式显示名称
getModeDisplayName(mode) {
    const modeNames = {
        'auto': '自动',
        'lyrics': '歌词',
        'audio': '音频',
        'sync': '同步'
    };
    return modeNames[mode] || mode;
}

// 切换歌曲播放模式
changeSongMode(songIndex, newMode) {
    if (songIndex < 0 || songIndex >= this.songs.length) return;

    const song = this.songs[songIndex];
    const oldMode = song.userMode || 'auto';
    song.userMode = newMode;

    // 如果正在播放这首歌，立即应用模式切换
    if (this.currentSongIndex === songIndex && this.isPlaying) {
        this.applyModeChange(song);
    }

    // 更新UI显示
    this.updatePlaylist();
    this.showNotification(
        `"${song.name}" 已切换到${this.getModeDisplayName(newMode)}模式`,
        'success'
    );

    log(`歌曲 "${song.name}" 模式从 ${oldMode} 切换到 ${newMode}`);
}

// 应用模式切换到当前播放的歌曲
applyModeChange(song) {
    const effectiveMode = this.getEffectiveMode(song);
    const wasPlaying = this.isPlaying;
    const currentTime = this.currentTime;

    log('应用模式切换:', effectiveMode);

    // 暂停当前播放
    this.pause();

    // 重新设置播放模式
    this.setupPlaybackMode(song, effectiveMode);

    // 恢复播放状态
    if (wasPlaying) {
        const timerId = setTimeout(() => {
            this.setCurrentTime(currentTime);
            this.play();
        }, 100);
        this.addTimer(timerId);
    }
}

// 设置播放模式（重新组织播放逻辑）
setupPlaybackMode(song, mode) {
    // 清理之前的音频
    if (this.audioElement) {
        this.audioElement.pause();
    }

    // 根据模式设置播放环境
    switch (mode) {
        case 'sync':
            if (song.audioElement) {
                this.audioElement = song.audioElement;
                this.audioMode = true;
            }
            break;
        case 'audio':
            if (song.audioElement) {
                this.audioElement = song.audioElement;
                this.audioMode = true;
            }
            break;
        case 'lyrics':
        default:
            this.audioMode = false;
            this.audioElement = null;
            break;
    }

    // 更新界面显示
    this.updateSongDisplay();
    this.updateAudioMode();
}

// 歌词手动跳转功能
jumpToLyric(lyricIndex) {
    const song = this.songs[this.currentSongIndex];
    if (!song || !song.lyrics || lyricIndex < 0 || lyricIndex >= song.lyrics.length) {
        return false;
    }

    // 获取目标时间
    const targetTime = song.lyrics[lyricIndex].time;

    // 跳转到指定时间
    this.setCurrentTime(targetTime);

    // 清除歌词缓存以确保立即更新
    this.lyricsCache.clear();

    // 强制更新歌词索引和显示
    this.currentLyricIndex = lyricIndex;

    // 强制更新显示
    const currentLyric = song.lyrics[lyricIndex].text;
    const nextLyric = lyricIndex < song.lyrics.length - 1 ? song.lyrics[lyricIndex + 1].text : '';
    this.showLyrics(currentLyric, nextLyric);

    // 更新进度条
    this.updateProgress();

    // 更新歌词进度指示器
    this.updateLyricProgress();

    log(`跳转到第 ${lyricIndex + 1} 句: "${currentLyric}"`);
    return true;
}

// 下一句歌词
nextLyric() {
    const song = this.songs[this.currentSongIndex];
    if (!song || !song.lyrics) return false;

    if (this.currentLyricIndex < song.lyrics.length - 1) {
        return this.jumpToLyric(this.currentLyricIndex + 1);
    }
    return false;
}

// 上一句歌词
previousLyric() {
    if (this.currentLyricIndex > 0) {
        return this.jumpToLyric(this.currentLyricIndex - 1);
    }
    return false;
}

// 跳转到第一句
firstLyric() {
    return this.jumpToLyric(0);
}

// 跳转到最后一句
lastLyric() {
    const song = this.songs[this.currentSongIndex];
    if (!song || !song.lyrics) return false;

    return this.jumpToLyric(song.lyrics.length - 1);
}

// 获取当前歌词进度信息
getLyricProgress() {
    const song = this.songs[this.currentSongIndex];
    if (!song || !song.lyrics) return null;

    return {
        current: this.currentLyricIndex + 1,
        total: song.lyrics.length,
        progress: (this.currentLyricIndex + 1) / song.lyrics.length
    };
}

// 显示歌词跳转通知
showLyricJumpNotification(action) {
    const progress = this.getLyricProgress();
    if (!progress) return;

    const song = this.songs[this.currentSongIndex];
    const currentLyric = song.lyrics[this.currentLyricIndex];

    const message = `${action} (${progress.current}/${progress.total}): ${currentLyric.text}`;
    this.showNotification(message, 'info');
}

// 更新歌词进度指示器
updateLyricProgress() {
    const progress = this.getLyricProgress();
    const lyricProgressEl = document.getElementById('lyricProgress');
    const lyricProgressText = document.getElementById('lyricProgressText');

    if (!progress || !lyricProgressEl || !lyricProgressText) {
        if (lyricProgressEl) lyricProgressEl.style.display = 'none';
        return;
    }

    const song = this.songs[this.currentSongIndex];
    const songMode = this.getEffectiveMode(song);

    // 只在有歌词的模式下显示进度
    if (songMode === 'lyrics' || songMode === 'sync') {
        lyricProgressEl.style.display = 'block';
        lyricProgressText.textContent = `歌词 ${progress.current} / ${progress.total}`;
    } else {
        lyricProgressEl.style.display = 'none';
    }
}

    // 防止屏幕熄屏功能
    async requestWakeLock() {
    if (!this.wakeLockSupported) {
        log('浏览器不支持Screen Wake Lock API');
        return;
    }

    try {
        if (this.wakeLock) {
            await this.wakeLock.release();
        }

        this.wakeLock = await navigator.wakeLock.request('screen');
        log('已启用屏幕保持唤醒');

        // 监听唤醒锁释放事件
        this.wakeLock.addEventListener('release', () => {
            log('屏幕唤醒锁已释放');
            this.wakeLock = null;
        });

        this.showNotification('已启用屏幕保持唤醒', 'success');
    } catch (err) {
        console.error('无法启用屏幕保持唤醒:', err);
        this.showNotification('无法启用屏幕保持唤醒', 'warning');
    }
}
    
    async releaseWakeLock() {
    if (this.wakeLock) {
        try {
            await this.wakeLock.release();
            this.wakeLock = null;
            log('已释放屏幕唤醒锁');
            this.showNotification('已允许屏幕熄屏', 'info');
        } catch (err) {
            console.error('释放屏幕唤醒锁失败:', err);
        }
    }
}

// 检查并处理页面可见性变化
handleVisibilityChange() {
    if (document.hidden) {
        // 页面隐藏时不需要特别处理，wakeLock会自动释放
    } else {
        // 页面重新可见时，如果正在播放，重新请求唤醒锁
        if (this.isPlaying) {
            this.requestWakeLock();
        }
    }
}

// 处理文件夹中的文件
processFolderFiles(files, type) {
    if (files.length === 0) {
        this.showNotification('文件夹为空', 'warning');
        return;
    }

    let validFiles = [];
    let totalFiles = files.length;
    let processedFiles = 0;

    // 根据类型过滤文件
    if (type === 'lyrics') {
        validFiles = files.filter(file =>
            file.name.toLowerCase().endsWith('.lrc') ||
            file.name.toLowerCase().endsWith('.txt')
        );
    } else if (type === 'audio') {
        validFiles = files.filter(file => {
            const ext = file.name.toLowerCase().split('.').pop();
            return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'mp4'].includes(ext);
        });
    }

    log(`文件夹扫描完成: 总文件 ${totalFiles} 个, 有效${type === 'lyrics' ? '歌词' : '音频'}文件 ${validFiles.length} 个`);

    if (validFiles.length === 0) {
        const fileTypeName = type === 'lyrics' ? '歌词文件 (.lrc/.txt)' : '音频文件';
        this.showNotification(`文件夹中没有找到${fileTypeName}`, 'warning');
        return;
    }

    // 显示加载进度
    this.showNotification(`正在加载 ${validFiles.length} 个${type === 'lyrics' ? '歌词' : '音频'}文件...`, 'info');

    // 按文件夹路径分组显示
    const folderGroups = {};
    validFiles.forEach(file => {
        const folderPath = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : '根目录';
        if (!folderGroups[folderPath]) {
            folderGroups[folderPath] = [];
        }
        folderGroups[folderPath].push(file);
    });

    // 显示文件夹结构信息
    log('文件夹结构:');
    Object.keys(folderGroups).forEach(folder => {
        log(`  📁 ${folder}: ${folderGroups[folder].length} 个文件`);
    });

    // 加载文件
    if (type === 'lyrics') {
        this.loadLrcFiles(validFiles);
    } else if (type === 'audio') {
        this.loadAudioFiles(validFiles);
    }

    // 成功提示
    const folderCount = Object.keys(folderGroups).length;
    const folderText = folderCount > 1 ? ` (来自 ${folderCount} 个文件夹)` : '';
    this.showNotification(
        `成功加载 ${validFiles.length} 个${type === 'lyrics' ? '歌词' : '音频'}文件${folderText}`,
        'success'
    );

    // 如果是音频文件，显示匹配报告并自动排序
    if (type === 'audio') {
        const timerId = setTimeout(() => {
            this.showMatchingReport();
            // 自动排序歌曲列表
            this.sortPlaylist();
            this.updatePlaylist();
            this.showNotification('歌曲列表已自动排序', 'success');
        }, 1000);
        this.addTimer(timerId);
    } else if (type === 'lyrics') {
        // 如果只是加载歌词文件，也进行排序
        const timerId = setTimeout(() => {
            this.sortPlaylist();
            this.updatePlaylist();
            this.showNotification('歌曲列表已自动排序', 'success');
        }, 500);
        this.addTimer(timerId);
    }
}

// 显示匹配报告
showMatchingReport() {
    const syncSongs = this.songs.filter(song => song.mode === 'sync');
    const audioOnlySongs = this.songs.filter(song => song.mode === 'audio');
    const lyricsOnlySongs = this.songs.filter(song => song.mode === 'lyrics');

    log('🎵 文件匹配报告:');
    log(`- 同步模式 (有歌词+音频): ${syncSongs.length} 首`);
    log(`- 纯音频模式: ${audioOnlySongs.length} 首`);
    log(`- 纯歌词模式: ${lyricsOnlySongs.length} 首`);
    log(`- 总计: ${this.songs.length} 首歌曲`);

    if (syncSongs.length > 0) {
        log('\n✅ 成功匹配的歌曲:');
        syncSongs.forEach((song, index) => {
            log(`  ${index + 1}. "${song.name}" (同步模式)`);
        });
    }

    if (audioOnlySongs.length > 0) {
        log('\n🎶 未匹配的音频文件:');
        audioOnlySongs.forEach((song, index) => {
            log(`  ${index + 1}. "${song.name}" (纯音频)`);
        });
    }

    if (lyricsOnlySongs.length > 0) {
        log('\n📝 未匹配的歌词文件:');
        lyricsOnlySongs.forEach((song, index) => {
            log(`  ${index + 1}. "${song.name}" (纯歌词)`);
        });
    }

    // 显示匹配统计通知
    const matchRate = syncSongs.length / Math.max(this.songs.length, 1);
    let message = `匹配完成: ${syncSongs.length}/${this.songs.length} 首歌曲成功配对`;

    if (matchRate >= 0.8) {
        this.showNotification(`${message} ✨`, 'success');
    } else if (matchRate >= 0.5) {
        this.showNotification(`${message} ⚠️`, 'warning');
    } else {
        this.showNotification(`${message} - 请检查文件名`, 'info');
    }
}

trackObjectUrl(url) {
    this.objectUrls.add(url);
}

revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
    this.objectUrls.delete(url);
}
}
