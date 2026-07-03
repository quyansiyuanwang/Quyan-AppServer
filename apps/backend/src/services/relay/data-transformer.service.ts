import logger from "@/util/logger";

/**
 * 简化的转换配置 - 直接针对监控数据结构
 */
export interface SimpleTransformConfig {
  version: string;
  enabled: boolean;
  filterUnmatched?: boolean; // 是否过滤未匹配的监控项（默认false）
  monitors: MonitorTransformRule[];
}

export interface MonitorTransformRule {
  // 匹配规则
  namePattern: string; // 支持正则表达式或精确匹配
  matchType: "exact" | "regex"; // 匹配类型

  // 转换规则
  displayName?: string; // 新的显示名称
  hideFields?: string[]; // 要隐藏的字段列表
}

/**
 * 数据转换服务 - 简化版
 * 直接针对上游监控数据结构进行转换
 */
export class DataTransformerService {
  private static instance: DataTransformerService;

  private constructor() {}

  public static getInstance(): DataTransformerService {
    if (!DataTransformerService.instance) DataTransformerService.instance = new DataTransformerService();

    return DataTransformerService.instance;
  }

  /**
   * 转换上游监控数据
   * @param data 上游数据 - 可以是对象或数组
   * @returns 转换后的数据
   */
  public transform(data: any, config: SimpleTransformConfig): any {
    try {
      if (!config || !config.enabled || !config.monitors || config.monitors.length === 0) {
        logger.info("Transform skipped - config not enabled or empty");
        return data;
      }

      logger.info("Starting transformation", {
        dataType: Array.isArray(data) ? "array" : typeof data,
        rulesCount: config.monitors.length,
      });

      // 深拷贝避免修改原始数据
      const result = JSON.parse(JSON.stringify(data));

      // 处理数据 - 可能是单个对象或数组
      const categories = Array.isArray(result) ? result : [result];

      for (const category of categories)
        if (category.monitors && Array.isArray(category.monitors)) {
          logger.info("Processing category", {
            categoryName: category.categoryName,
            monitorsCount: category.monitors.length,
          });

          // 转换并过滤监控项
          const transformedMonitors: any[] = [];
          for (const monitor of category.monitors) {
            const matched = this.applyMonitorTransform(monitor, config.monitors);
            // 如果启用过滤且未匹配，则跳过该监控项
            if (config.filterUnmatched && !matched) {
              logger.info("Filtering unmatched monitor", { name: monitor.name });
              continue;
            }
            transformedMonitors.push(monitor);
          }
          category.monitors = transformedMonitors;
        }

      logger.info("Transformation completed");
      return result;
    } catch (error) {
      logger.error("Data transformation failed", { error, config });
      return data;
    }
  }

  /**
   * 对单个监控项应用转换规则
   * @returns 是否匹配到规则
   */
  private applyMonitorTransform(monitor: any, rules: MonitorTransformRule[]): boolean {
    const monitorName = monitor.name;
    if (!monitorName) {
      logger.warn("Monitor has no name field", { monitor });
      return false;
    }

    logger.info("Processing monitor", { name: monitorName });

    // 查找匹配的规则
    for (const rule of rules) {
      let matched = false;

      if (rule.matchType === "exact")
        // 精确匹配
        matched = monitorName === rule.namePattern;
      else if (rule.matchType === "regex")
        // 正则匹配
        try {
          const regex = new RegExp(rule.namePattern);
          matched = regex.test(monitorName);
        } catch (error) {
          logger.warn("Invalid regex pattern", { pattern: rule.namePattern, error });
          continue;
        }

      if (matched) {
        logger.info("Rule matched", {
          monitorName,
          rule,
        });

        // 应用转换规则
        if (rule.displayName) {
          logger.info("Renaming monitor", {
            from: monitor.name,
            to: rule.displayName,
          });
          monitor.name = rule.displayName;
        }

        if (rule.hideFields && rule.hideFields.length > 0)
          for (const field of rule.hideFields)
            if (field in monitor) {
              logger.info("Deleting field", {
                monitorName: monitor.name,
                field,
              });
              delete monitor[field];
            }

        // 找到匹配规则后停止（只应用第一个匹配的规则）
        return true;
      }
    }

    return false;
  }
}
