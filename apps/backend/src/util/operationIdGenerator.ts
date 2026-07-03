/**
 * 为路由生成唯一的标识符，用于 API 文档、日志和权限管理。
 * 标识符格式: {PrefixTitle}{PathSegments}{Method}
 * - PrefixTitle: 最后一个 tag 的首字母大写形式（这里使用控制器名作为 tag）
 * - PathSegments: 路径各段的首字母大写形式（仅保留字母）
 * - Method: HTTP 方法的首字母大写形式
 */
export function generateUniqueOperationId(
  controllerName: string, // 控制器名，作为 tag
  routePath: string, // 路由路径，如 "/users/{id}"
  method: string, // HTTP 方法，如 "get"
): string {
  // 只保留字母，去除其他字符
  const cleanSegment = (segment: string): string => {
    return segment.replace(/[^A-Za-z]/g, "").replace(/^\w/, (c) => c.toUpperCase());
  };

  // 处理路径：分割并清理各段
  const segments = routePath
    .split("/")
    .filter((seg) => seg)
    .map(cleanSegment);
  let formatted = segments.join("");

  // 处理标签（使用控制器名）
  const prefix = controllerName.replace(/^\w/, (c) => c.toUpperCase());

  // 处理方法
  const methodTitle = method.replace(/^\w/, (c) => c.toUpperCase());

  // 如果 formatted 以 prefix 开头，去除前缀避免重复
  if (formatted.startsWith(prefix)) formatted = formatted.slice(prefix.length);

  return `${prefix}Service${formatted}${methodTitle}`;
}

/**
 * 生成唯一的 operationId，如果重复则添加后缀
 * @param base 基础 ID
 * @param used 已使用的 ID 集合
 * @returns 唯一的 operationId
 */
export function generateUniqueOperationIdWithSet(base: string, used: Set<string>): string {
  let id = base;
  let counter = 1;
  while (used.has(id)) {
    id = `${base}_${counter}`;
    counter++;
  }
  used.add(id);
  return id;
}
