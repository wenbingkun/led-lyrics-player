#!/bin/bash

# 检查 urls.txt 是否存在
if [ ! -f urls.txt ]; then
    echo "错误：未找到 urls.txt 文件"
    echo "请创建一个 urls.txt 文件，并在其中填入 Bilibili 视频链接（每行一个）"
    exit 1
fi

# 检查 BBDown 是否存在
if [ ! -f ./bbdown_tool ]; then
    echo "错误：未找到 bbdown_tool"
    echo "请确保 BBDown 已安装并在当前目录下命名为 bbdown_tool"
    exit 1
fi

# 检查 ffmpeg 是否存在
if ! command -v ffmpeg &> /dev/null; then
    echo "错误：未找到 ffmpeg"
    echo "请先安装 ffmpeg (如: sudo apt install ffmpeg)"
    exit 1
fi

# 创建目录
mkdir -p mp3
mkdir -p raw_audio

echo "=== 开始读取 urls.txt 并下载 ==="

# 读取 urls.txt
while IFS= read -r url || [[ -n "$url" ]]; do
    # 跳过空行和注释行
    if [[ -z "$url" ]] || [[ "$url" == \#* ]]; then continue; fi
    
    echo "------------------------------------------------"
    echo "正在下载: $url"
    
    # 使用 BBDown 下载
    # --audio-only: 仅下载音频
    # --work-dir: 下载目录
    # --force-http: 避免部分 HTTPS 问题
    ./bbdown_tool "$url" --audio-only --work-dir raw_audio
    
done < urls.txt

echo "------------------------------------------------"
echo "下载阶段结束，开始转换格式..."

# 遍历 raw_audio 目录下的所有音频文件 (主要是 m4a)
find raw_audio -type f \( -name "*.m4a" -o -name "*.mp4" -o -name "*.webm" \) | while read filename; do
    # 获取文件名（不带扩展名）
    basename=$(basename "$filename")
    name_no_ext="${basename%.*}"
    
    echo "正在转换: $name_no_ext"
    
    # 使用 ffmpeg 转换为 mp3
    # -q:a 2 表示高质量 VBR
    # -y 覆盖已存在文件
    # < /dev/null 防止 ffmpeg 吞掉 while 循环的输入
    ffmpeg -i "$filename" -acodec libmp3lame -q:a 2 "mp3/${name_no_ext}.mp3" -y < /dev/null
    
    if [ $? -eq 0 ]; then
        echo "转换成功: mp3/${name_no_ext}.mp3"
        # 转换成功后删除源文件
        rm "$filename"
    else
        echo "转换失败: $filename"
    fi
done

echo "=== 所有任务完成！ ==="
echo "MP3 文件已保存在 mp3/ 文件夹中。"
echo "歌词文件应放在 lyrics/ 文件夹中。"

# 清理空目录
rmdir raw_audio 2>/dev/null
