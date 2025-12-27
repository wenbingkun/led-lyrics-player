import { LEDLyricsPlayer } from './player.js';
import { log } from './utils.js';

class LyricsPlayerApp {
    static init() {
        document.addEventListener('DOMContentLoaded', () => {
            window.player = new LEDLyricsPlayer();
            // 暴露给全局以便调试
            window.LyricsPlayerApp = { player: window.player };
            log('LED歌词播放器初始化完成 (模块化版)');
        });
    }
}

LyricsPlayerApp.init();
