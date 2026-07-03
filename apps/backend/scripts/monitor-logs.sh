#!/bin/bash

# 实时监控图片请求日志
# 使用方法: ./scripts/monitor-logs.sh

LOG_FILE="logs/combined-$(date +%Y-%m-%d).log"

if [ ! -f "$LOG_FILE" ]; then
    echo "错误: 日志文件不存在: $LOG_FILE"
    echo "请确保已启用文件日志: ENABLE_FILE_LOGGING=true"
    exit 1
fi

# Check if output is a TTY (supports colors)
USE_COLORS=false
if [ -t 1 ]; then
    USE_COLORS=true
fi

echo "=== 实时监控图片请求 ==="
echo "日志文件: $LOG_FILE"
echo "按 Ctrl+C 停止"
echo ""

if [ "$USE_COLORS" = true ]; then
    echo "图例:"
    echo "  🟢 绿色 = 请求接收"
    echo "  🟡 黄色 = 队列等待"
    echo "  🔴 红色 = 超时/错误"
    echo "  🔵 蓝色 = 请求完成"
    echo ""
fi

tail -f "$LOG_FILE" | while read -r line; do
    # 图片请求接收
    if echo "$line" | grep -q "Image request received"; then
        SIZE=$(echo "$line" | grep -oP 'requestSizeMB["\s:]+\K[0-9.]+' 2>/dev/null || echo "?")
        MODEL=$(echo "$line" | grep -oP 'model["\s:]+\K[^",}]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;32m[接收] ${SIZE}MB - ${MODEL}\033[0m"
        else
            echo "[接收] ${SIZE}MB - ${MODEL}"
        fi

    # 并发控制
    elif echo "$line" | grep -q "Image request concurrency guard"; then
        MAX=$(echo "$line" | grep -oP 'maxConcurrency["\s:]+\K[0-9]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;33m[限制] 最大并发: ${MAX}\033[0m"
        else
            echo "[限制] 最大并发: ${MAX}"
        fi

    # 队列等待
    elif echo "$line" | grep -q "Request queued"; then
        CURRENT=$(echo "$line" | grep -oP 'currentConcurrency["\s:]+\K[0-9]+' 2>/dev/null || echo "?")
        MAX=$(echo "$line" | grep -oP 'maxConcurrency["\s:]+\K[0-9]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;33m[排队] 当前: ${CURRENT}/${MAX}\033[0m"
        else
            echo "[排队] 当前: ${CURRENT}/${MAX}"
        fi

    # 获得槽位
    elif echo "$line" | grep -q "Concurrency slot acquired after waiting"; then
        WAIT=$(echo "$line" | grep -oP 'waitTimeSec["\s:]+\K[0-9.]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;32m[获得] 等待: ${WAIT}秒\033[0m"
        else
            echo "[获得] 等待: ${WAIT}秒"
        fi

    # 请求完成
    elif echo "$line" | grep -q "Image request completed"; then
        DURATION=$(echo "$line" | grep -oP 'durationSec["\s:]+\K[0-9.]+' 2>/dev/null || echo "?")
        SIZE=$(echo "$line" | grep -oP 'requestSizeMB["\s:]+\K[0-9.]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;34m[完成] ${SIZE}MB - 耗时: ${DURATION}秒\033[0m"
        else
            echo "[完成] ${SIZE}MB - 耗时: ${DURATION}秒"
        fi

    # 超时
    elif echo "$line" | grep -q "Request queue timeout"; then
        WAIT=$(echo "$line" | grep -oP 'waitTimeSec["\s:]+\K[0-9.]+' 2>/dev/null || echo "?")
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;31m[超时] 等待: ${WAIT}秒\033[0m"
        else
            echo "[超时] 等待: ${WAIT}秒"
        fi

    # 错误
    elif echo "$line" | grep -qi "error"; then
        if [ "$USE_COLORS" = true ]; then
            echo -e "\033[1;31m[错误] $line\033[0m"
        else
            echo "[错误] $line"
        fi
    fi
done
