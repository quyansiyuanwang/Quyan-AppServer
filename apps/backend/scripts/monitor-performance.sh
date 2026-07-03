#!/bin/bash

# 性能监控脚本 - 用于诊断 2v2g 服务器卡死问题
# 使用方法: ./scripts/monitor-performance.sh

echo "=== AppServer 性能监控 ==="
echo "时间: $(date)"
echo ""

# 1. CPU 使用率
echo "--- CPU 使用率 ---"
NODE_PID=$(pgrep -f "node.*dist/index.cjs" | head -1)
if [ -n "$NODE_PID" ]; then
    echo "Node.js PID: $NODE_PID"
    ps -p $NODE_PID -o %cpu,%mem,cmd
else
    echo "Node.js 进程未运行"
fi
echo ""

# 2. 内存使用
echo "--- 内存使用 ---"
free -h
echo ""

# 3. 活跃连接数
echo "--- 活跃连接数 ---"
PORT=${PORT:-10001}

# Try ss first (modern), fallback to netstat (deprecated but still common)
if command -v ss &> /dev/null; then
    CONNECTIONS=$(ss -an 2>/dev/null | grep ":$PORT" | wc -l)
    ESTABLISHED=$(ss -an 2>/dev/null | grep ":$PORT.*ESTAB" | wc -l)
    TIME_WAIT=$(ss -an 2>/dev/null | grep ":$PORT.*TIME-WAIT" | wc -l)
elif command -v netstat &> /dev/null; then
    CONNECTIONS=$(netstat -an 2>/dev/null | grep ":$PORT" | wc -l)
    ESTABLISHED=$(netstat -an 2>/dev/null | grep ":$PORT.*ESTABLISHED" | wc -l)
    TIME_WAIT=$(netstat -an 2>/dev/null | grep ":$PORT.*TIME_WAIT" | wc -l)
else
    echo "ss 和 netstat 都不可用，无法检查连接数"
    CONNECTIONS=0
    ESTABLISHED=0
    TIME_WAIT=0
fi

echo "总连接数: $CONNECTIONS"
echo "已建立: $ESTABLISHED"
echo "TIME_WAIT: $TIME_WAIT"
echo ""

# 4. 文件描述符
echo "--- 文件描述符 ---"
if [ -n "$NODE_PID" ]; then
    FD_COUNT=$(ls -1 /proc/$NODE_PID/fd 2>/dev/null | wc -l)
    FD_LIMIT=$(cat /proc/$NODE_PID/limits 2>/dev/null | grep "open files" | awk '{print $4}')
    echo "已使用: $FD_COUNT"
    echo "限制: $FD_LIMIT"
    # Use awk instead of bc for better compatibility
    if [ -n "$FD_LIMIT" ] && [ "$FD_LIMIT" -gt 0 ]; then
        USAGE=$(awk "BEGIN {printf \"%.2f\", $FD_COUNT * 100 / $FD_LIMIT}")
        echo "使用率: ${USAGE}%"
    fi
else
    echo "无法获取文件描述符信息"
fi
echo ""

# 5. 磁盘 I/O
echo "--- 磁盘使用 ---"
df -h | grep -E "Filesystem|/$"
echo ""

# 6. 系统负载
echo "--- 系统负载 ---"
uptime
echo ""

# 7. PM2 状态（如果使用 PM2）
if command -v pm2 &> /dev/null; then
    echo "--- PM2 状态 ---"
    pm2 list
    echo ""
fi

# 8. 最近的错误日志
echo "--- 最近的错误日志 (最后 10 行) ---"
if [ -f "logs/error.log" ]; then
    tail -10 logs/error.log
else
    echo "未找到错误日志文件"
fi
echo ""

# 9. Redis 连接（如果使用 Redis）
echo "--- Redis 状态 ---"
if command -v redis-cli &> /dev/null; then
    redis-cli ping 2>/dev/null && echo "Redis: 正常" || echo "Redis: 无法连接"
else
    echo "Redis CLI 未安装"
fi
echo ""

# 10. 建议
echo "=== 性能建议 ==="
if [ -n "$NODE_PID" ]; then
    CPU_USAGE=$(ps -p $NODE_PID -o %cpu= | awk '{print int($1)}')
    MEM_USAGE=$(ps -p $NODE_PID -o %mem= | awk '{print int($1)}')

    if [ $CPU_USAGE -gt 80 ]; then
        echo "⚠️  CPU 使用率过高 ($CPU_USAGE%) - 考虑降低 maxConcurrency"
    fi

    if [ $MEM_USAGE -gt 70 ]; then
        echo "⚠️  内存使用率过高 ($MEM_USAGE%) - 考虑降低请求体大小限制"
    fi

    if [ $ESTABLISHED -gt 50 ]; then
        echo "⚠️  活跃连接数过多 ($ESTABLISHED) - 考虑降低 maxSockets"
    fi

    if [ $TIME_WAIT -gt 100 ]; then
        echo "⚠️  TIME_WAIT 连接过多 ($TIME_WAIT) - 可能需要调整 TCP 参数"
    fi
fi

echo ""
echo "=== 监控完成 ==="
