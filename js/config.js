export const DEBUG = false;

export const CONFIG = {
    // 字体大小配置 (rem)
    FONT_SIZE: {
        CURRENT_LYRIC_BASE: 8,  // 当前歌词基础字号
        NEXT_LYRIC_BASE: 4      // 下一句歌词基础字号
    },
    // 节流配置 (ms)
    THROTTLE: {
        LYRICS_UPDATE: 50       // 歌词更新节流间隔
    },
    // 歌词解析配置
    LRC: {
        APPLY_OFFSET: true,     // 是否应用 [offset] 偏移
        MERGE_DUPLICATES: true  // 是否合并同时间戳歌词
    }
};
