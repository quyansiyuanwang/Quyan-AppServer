#!/bin/bash

# 图片请求日志分析脚本
# 使用方法: ./scripts/analyze-image-requests.sh [log-file]
# 注意: 此脚本需要 GNU grep。在 macOS 上，请安装 GNU grep: brew install grep

LOG_FILE=${1:-"logs/combined.log"}

if [ ! -f "$LOG_FILE" ]; then
    echo "错误: 日志文件不存在: $LOG_FILE"
    echo "使用方法: $0 [log-file]"
    echo "示例: $0 logs/combined.log"
    exit 1
fi

# Check if GNU grep is available
GREP_CMD="grep"
if ! grep -P "" /dev/null 2>/dev/null; then
    # Try ggrep (GNU grep on macOS)
    if command -v ggrep &> /dev/null; then
        GREP_CMD="ggrep"
    else
        echo "警告: 未找到支持 -P 选项的 grep"
        echo "在 macOS 上，请安装 GNU grep: brew install grep"
        echo "或者使用 Linux 系统运行此脚本"
        exit 1
    fi
fi

echo "=== 图片请求日志分析 ==="
echo "日志文件: $LOG_FILE"
echo "分析时间: $(date)"
echo ""

# 1. 统计图片请求总数
echo "--- 图片请求统计 ---"
IMAGE_REQUESTS=$($GREP_CMD -c "Image request" "$LOG_FILE" 2>/dev/null || echo "0")
echo "总图片请求数: $IMAGE_REQUESTS"
echo ""

# 2. 按请求大小分组
echo "--- 请求大小分布 ---"
echo "超大请求 (>10MB):"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | awk '{if($1>10) print $1"MB"}' | wc -l

echo "大请求 (5-10MB):"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | awk '{if($1>=5 && $1<=10) print $1"MB"}' | wc -l

echo "中等请求 (1-5MB):"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | awk '{if($1>=1 && $1<5) print $1"MB"}' | wc -l

echo "小请求 (<1MB):"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | awk '{if($1<1) print $1"MB"}' | wc -l
echo ""

# 3. 最大的请求
echo "--- 最大的 10 个请求 ---"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | sort -rn | head -10 | awk '{print $1" MB"}'
echo ""

# 4. 队列等待情况
echo "--- 队列等待统计 ---"
QUEUED=$($GREP_CMD -c "Request queued" "$LOG_FILE" 2>/dev/null || echo "0")
echo "进入队列的请求数: $QUEUED"

if [ "$QUEUED" -gt 0 ]; then
    echo ""
    echo "等待时间分布:"
    $GREP_CMD "Concurrency slot acquired after waiting" "$LOG_FILE" | $GREP_CMD -oP 'waitTimeSec["\s:]+\K[0-9.]+' | awk '
    {
        if ($1 < 5) count_0_5++
        else if ($1 < 10) count_5_10++
        else if ($1 < 30) count_10_30++
        else count_30_plus++
    }
    END {
        print "  0-5秒: " count_0_5+0
        print "  5-10秒: " count_5_10+0
        print "  10-30秒: " count_10_30+0
        print "  >30秒: " count_30_plus+0
    }'
fi
echo ""

# 5. 超时情况
echo "--- 超时统计 ---"
TIMEOUTS=$($GREP_CMD -c "Request queue timeout" "$LOG_FILE" 2>/dev/null || echo "0")
echo "超时请求数: $TIMEOUTS"

if [ "$TIMEOUTS" -gt 0 ]; then
    echo ""
    echo "最近 5 个超时请求:"
    $GREP_CMD "Request queue timeout" "$LOG_FILE" | tail -5
fi
echo ""

# 6. 请求处理时间
echo "--- 处理时间统计 ---"
COMPLETED=$($GREP_CMD -c "Image request completed" "$LOG_FILE" 2>/dev/null || echo "0")
echo "完成的请求数: $COMPLETED"

if [ "$COMPLETED" -gt 0 ]; then
    echo ""
    echo "处理时间分布:"
    $GREP_CMD "Image request completed" "$LOG_FILE" | $GREP_CMD -oP 'durationSec["\s:]+\K[0-9.]+' | awk '
    {
        if ($1 < 10) count_0_10++
        else if ($1 < 30) count_10_30++
        else if ($1 < 60) count_30_60++
        else count_60_plus++
        sum += $1
        count++
    }
    END {
        print "  0-10秒: " count_0_10+0
        print "  10-30秒: " count_10_30+0
        print "  30-60秒: " count_30_60+0
        print "  >60秒: " count_60_plus+0
        if (count > 0) print "  平均: " sum/count "秒"
    }'
fi
echo ""

# 7. 按用户统计
echo "--- 用户请求统计 (Top 10) ---"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'userId["\s:]+\K[^",}]+' | sort | uniq -c | sort -rn | head -10 | awk '{print "用户 " $2 ": " $1 " 个请求"}'
echo ""

# 8. 按模型统计
echo "--- 模型使用统计 ---"
$GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'model["\s:]+\K[^",}]+' | sort | uniq -c | sort -rn | awk '{print $2 ": " $1 " 次"}'
echo ""

# 9. 最近的图片请求
echo "--- 最近 5 个图片请求 ---"
$GREP_CMD "Image request received" "$LOG_FILE" | tail -5 | while read -r line; do
    # Try to extract and format JSON, fallback to raw line if tools not available
    JSON_PART=$(echo "$line" | $GREP_CMD -oP '\{.*\}')
    if [ -n "$JSON_PART" ]; then
        # Try jq first (most common), then python3, then node, then raw output
        if command -v jq &> /dev/null; then
            echo "$JSON_PART" | jq . 2>/dev/null || echo "$line"
        elif command -v python3 &> /dev/null; then
            echo "$JSON_PART" | python3 -m json.tool 2>/dev/null || echo "$line"
        elif command -v node &> /dev/null; then
            echo "$JSON_PART" | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2))" 2>/dev/null || echo "$line"
        else
            echo "$line"
        fi
    else
        echo "$line"
    fi
done
echo ""

# 10. 问题诊断
echo "=== 问题诊断 ==="

# 检查是否有大量队列等待
if [ "$QUEUED" -gt "$((IMAGE_REQUESTS / 2))" ]; then
    echo "⚠️  警告: 超过 50% 的请求需要排队等待"
    echo "   建议: 提高 RELAY_IMAGE_MAX_CONCURRENCY"
fi

# 检查是否有超时
if [ "$TIMEOUTS" -gt 0 ]; then
    echo "⚠️  警告: 发现 $TIMEOUTS 个超时请求"
    echo "   建议: 提高 RELAY_IMAGE_QUEUE_TIMEOUT_MS 或增加并发数"
fi

# 检查是否有超大请求
LARGE_REQUESTS=$($GREP_CMD "Image request" "$LOG_FILE" | $GREP_CMD -oP 'requestSizeMB["\s:]+\K[0-9.]+' | awk '{if($1>10) count++} END {print count+0}')
if [ "$LARGE_REQUESTS" -gt 0 ]; then
    echo "⚠️  警告: 发现 $LARGE_REQUESTS 个超大请求 (>10MB)"
    echo "   建议: 客户端压缩图片或提高 RELAY_MULTIPART_BODY_LIMIT_MB"
fi

# 检查平均处理时间
if [ "$COMPLETED" -gt 0 ]; then
    AVG_TIME=$($GREP_CMD "Image request completed" "$LOG_FILE" | $GREP_CMD -oP 'durationSec["\s:]+\K[0-9.]+' | awk '{sum+=$1; count++} END {print sum/count}')
    # Use awk for comparison instead of bc
    if [ -n "$AVG_TIME" ]; then
        IS_SLOW=$(awk "BEGIN {print ($AVG_TIME > 30) ? 1 : 0}")
        if [ "$IS_SLOW" = "1" ]; then
            echo "⚠️  警告: 平均处理时间过长 (${AVG_TIME}秒)"
            echo "   建议: 检查上游 API 性能或增加并发数"
        fi
    fi
fi

echo ""
echo "=== 分析完成 ==="
