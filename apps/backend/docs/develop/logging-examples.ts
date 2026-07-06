/**
 * 日志增强功能使用示例
 *
 * 本文件展示了如何使用新增的三个日志功能：
 * 1. 请求内容模糊搜索
 * 2. Logger 路由层装饰器
 * 3. Log 长内容截断
 */

import { Controller, Get, Post, Route, Security, Query, Body, Path } from "@tsoa/runtime";
import { LogRoute } from "@/util/logger-decorator";
import { LogCategory, getLogger } from "@/util/logger";
import { APILogRepository } from "@/store/apilog";

// ============================================
// 示例 1: 使用 @LogRoute 装饰器
// ============================================

@Route("example")
export class ExampleController extends Controller {
  private logger = getLogger("ExampleController", LogCategory.BUSINESS);

  /**
   * 基础用法：自动记录请求信息
   */
  @Get("basic")
  @Security("jwt")
  @LogRoute()
  public async basicExample() {
    return { message: "这个方法会自动记录请求信息" };
  }

  /**
   * 完整用法：记录请求和响应
   */
  @Get("detailed")
  @Security("jwt")
  @LogRoute({
    message: "详细日志示例",
    category: LogCategory.BUSINESS,
    logRequest: true,
    logResponse: true,
    level: "info",
  })
  public async detailedExample(@Query() keyword: string) {
    // 模拟业务逻辑
    const result = {
      keyword,
      data: Array(100).fill("item"),
      timestamp: new Date(),
    };

    // 响应会被自动截断并记录
    return result;
  }

  /**
   * 调试模式：使用 debug 级别
   */
  @Post("debug")
  @Security("jwt")
  @LogRoute({
    message: "调试接口",
    level: "debug",
    logRequest: true,
    logResponse: true,
  })
  public async debugExample(@Body() body: any) {
    this.logger.debug("处理调试请求", { body });
    return { success: true };
  }
}

// ============================================
// 示例 2: 手动使用截断功能
// ============================================

import { truncateContent } from "@/util/logger-decorator";

export class ManualTruncateExample {
  private logger = getLogger("ManualTruncateExample", LogCategory.BUSINESS);

  public processLargeData(data: any) {
    // 手动截断大型数据
    const truncated = truncateContent(data, 500);
    this.logger.info("处理大型数据", { data: truncated });
  }

  public logLargeArray(items: any[]) {
    // 截断数组
    const truncated = truncateContent(items, 300);
    this.logger.info(`处理 ${items.length} 个项目`, { preview: truncated });
  }
}

// ============================================
// 示例 3: 使用模糊搜索查询日志
// ============================================

export class LogSearchExample {
  private apiLogRepo = APILogRepository.getInstance();

  /**
   * 搜索包含特定关键词的所有日志
   */
  public async searchLogs(keyword: string) {
    const result = await this.apiLogRepo.query({
      search: keyword, // 模糊搜索：path, requestID, ipAddress, queryParams, bodyParams
      limit: 20,
      offset: 0,
    });

    return result;
  }

  /**
   * 组合搜索：关键词 + 时间范围
   */
  public async searchLogsWithDateRange(keyword: string, startDate: Date, endDate: Date) {
    const result = await this.apiLogRepo.query({
      search: keyword,
      startDate,
      endDate,
      limit: 50,
      offset: 0,
    });

    return result;
  }

  /**
   * 搜索特定用户的日志
   */
  public async searchUserLogs(username: string, keyword?: string) {
    const result = await this.apiLogRepo.query({
      user: username,
      search: keyword, // 可选：在用户日志中进一步搜索
      limit: 100,
      offset: 0,
    });

    return result;
  }
}

// ============================================
// 示例 4: 配置日志截断
// ============================================

import { LOG_TRUNCATE_CONFIG } from "@/util/logger";

export class ConfigExample {
  public configureLogTruncation() {
    // 修改截断配置（在应用启动时）
    LOG_TRUNCATE_CONFIG.maxFieldLength = 2000; // 增加单个字段最大长度
    LOG_TRUNCATE_CONFIG.maxContextLength = 10000; // 增加整体最大长度
    LOG_TRUNCATE_CONFIG.enabled = true; // 启用截断
  }

  public disableLogTruncation() {
    // 在某些场景下禁用截断（如调试）
    LOG_TRUNCATE_CONFIG.enabled = false;
  }
}

// ============================================
// 示例 5: 实际业务场景
// ============================================

@Route("users")
export class UserBusinessController extends Controller {
  private logger = getLogger("UserBusinessController", LogCategory.BUSINESS);

  /**
   * 用户登录：记录详细信息用于安全审计
   */
  @Post("login")
  @LogRoute({
    message: "用户登录",
    category: LogCategory.AUTH,
    logRequest: true,
    logResponse: false, // 不记录响应（包含 token）
    level: "info",
  })
  public async login(@Body() _credentials: { username: string; password: string }) {
    // 登录逻辑
    return { token: "xxx" };
  }

  /**
   * 批量导入用户：记录操作但截断大型数据
   */
  @Post("import")
  @Security("jwt")
  @LogRoute({
    message: "批量导入用户",
    category: LogCategory.BUSINESS,
    logRequest: true, // 会自动截断大型请求体
    logResponse: true, // 会自动截断大型响应
    level: "info",
  })
  public async importUsers(@Body() users: any[]) {
    this.logger.info(`开始导入 ${users.length} 个用户`);

    // 导入逻辑
    const result = {
      success: users.length,
      failed: 0,
      details: users.map((u) => ({ id: u.id, status: "success" })),
    };

    return result;
  }

  /**
   * 查询用户操作日志
   */
  @Get("{userId}/logs")
  @Security("jwt")
  @LogRoute({
    message: "查询用户操作日志",
    logRequest: true,
    logResponse: false, // 日志数据可能很大，不记录响应
  })
  public async getUserLogs(
    @Path() userId: string,
    @Query() keyword?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ) {
    const apiLogRepo = APILogRepository.getInstance();

    const result = await apiLogRepo.query({
      user: userId,
      search: keyword, // 模糊搜索
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: 100,
    });

    return result;
  }
}

// ============================================
// 使用建议
// ============================================

/**
 * 1. 何时使用 @LogRoute 装饰器：
 *    - 关键业务接口（登录、支付、权限变更等）
 *    - 需要审计的操作
 *    - 调试复杂业务逻辑
 *    - 不建议在高频接口使用（如心跳检测）
 *
 * 2. 何时使用模糊搜索：
 *    - 查找包含特定关键词的请求
 *    - 调试问题时搜索错误信息
 *    - 安全审计时搜索可疑操作
 *
 * 3. 截断配置建议：
 *    - 开发环境：可以增大限制或禁用截断
 *    - 生产环境：保持默认配置，防止日志过大
 *    - 调试时：临时禁用截断查看完整数据
 *
 * 4. 性能考虑：
 *    - @LogRoute 增加 < 5ms 开销
 *    - 模糊搜索建议配合时间范围使用
 *    - 定期清理旧日志（30-90天）
 */
