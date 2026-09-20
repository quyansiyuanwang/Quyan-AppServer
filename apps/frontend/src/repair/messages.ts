/** Recovery copy deliberately has no runtime i18n/storage/bootstrap dependencies. */
export const repairMessages = {
  'zh-CN': {
    title: '重新连接，从这里开始。',
    eyebrow: 'QUYAN / 登录修复',
    intro:
      '先检查，再清理。检测不会更改你的登录数据，也不会上传本地内容。并非所有登录失败都由缓存引起。',
    diagnose: '检查浏览器环境',
    auth: '重置登录状态',
    all: '清除本站应用数据',
    back: '返回登录',
    authHelp:
      '保留语言、主题和业务缓存；重置登录、验证码信任及受信任设备状态，可能需要重新二次验证。',
    allHelp:
      '仍无法登录时使用。删除当前站点可识别的应用数据、偏好和 IndexedDB；未同步草稿可能丢失，不删除服务端数据。',
    confirmAuth: '确定重置本机登录状态？其他标签页可能需要重新登录。',
    confirmAll:
      '确定清除当前站点应用数据？本地偏好、缓存及未同步草稿可能永久丢失。服务端数据不受影响。',
    confirmAgain: '最后确认：已保存需要保留的本地内容，并同意清除？',
    running: '正在处理，请稍候…',
    done: '已完成请求的处理。请返回登录后重试。',
    partial: '部分项目未完成或无法确认。请查看结果后重试。',
    checked: '检查完成。正常结果不代表可以排除所有登录问题。',
    ok: '正常 / 已完成',
    failed: '发现异常 / 未完成',
    unknown: '无法检测 / 无法确认',
    localStorage: '本地存储',
    sessionStorage: '标签页会话存储',
    indexedDB: '应用数据库',
    backend: '后端连接',
    cookies: 'HttpOnly Cookie：页面无法读取其内容',
    cookieInstructions: '服务端 Cookie 清除指令（不代表浏览器已接受）',
    sessionRevocation: '当前刷新凭据撤销',
    preferences: '共享偏好 Cookie',
    databaseCoverage: '全部数据库枚举',
    helpTitle: '仍然无法修复？',
    help: '关闭本站其他标签页后重试，避免数据库被占用。浏览器限制存储时，请检查隐私和站点权限设置。也可在浏览器设置中搜索“站点数据”，只选择本站并清除，然后重新打开登录页。',
    boundary:
      '仅处理当前站点可识别的应用数据。其他子域的本地存储需分别访问清理；共享 Cookie 可能影响同一部署的其他站点。本工具不会删除账号、Passkey 或服务端记录。',
  },
  en: {
    title: 'A clean start for signing in.',
    eyebrow: 'QUYAN / SIGN-IN RECOVERY',
    intro:
      'Check first, then reset. Diagnostics do not change your sign-in data or upload local contents. Not every sign-in failure is caused by cached data.',
    diagnose: 'Check browser environment',
    auth: 'Reset sign-in state',
    all: 'Clear this app’s local data',
    back: 'Return to sign in',
    authHelp:
      'Keep language, theme and business caches. Reset sign-in, CAPTCHA trust and trusted-device state. Two-factor verification may be required again.',
    allHelp:
      'Use if sign-in still fails. Remove recognized app storage, preferences and IndexedDB for this origin. Unsynced drafts may be lost; server data is not deleted.',
    confirmAuth: 'Reset sign-in state in this browser? Other tabs may need to sign in again.',
    confirmAll:
      'Clear this app’s local data? Preferences, caches and unsynced drafts may be permanently lost. Server data is unaffected.',
    confirmAgain:
      'Final confirmation: have you saved any local content you need and agreed to clear it?',
    running: 'Working. Please wait…',
    done: 'Requested operations completed. Return to sign in and try again.',
    partial:
      'Some operations failed or could not be confirmed. Review the results before retrying.',
    checked: 'Checks completed. A normal result cannot rule out every sign-in problem.',
    ok: 'Normal / completed',
    failed: 'Problem / not completed',
    unknown: 'Unavailable / unconfirmed',
    localStorage: 'Local storage',
    sessionStorage: 'Tab session storage',
    indexedDB: 'App databases',
    backend: 'Backend connection',
    cookies: 'HttpOnly cookies: their contents cannot be inspected by this page',
    cookieInstructions: 'Server cookie-clearing instructions (browser acceptance is not confirmed)',
    sessionRevocation: 'Current refresh credential revocation',
    preferences: 'Shared preference cookies',
    databaseCoverage: 'Enumeration of all databases',
    helpTitle: 'Still having trouble?',
    help: 'Close other tabs for this site and retry if a database is blocked. Check privacy and site-permission settings if storage is restricted. Alternatively, search for “site data” in browser settings, select only this site, clear its data and reopen sign-in.',
    boundary:
      'Only recognized application data on this origin is handled. Visit other subdomains separately to clear their storage. Shared cookies may affect other sites in the same deployment. Accounts, Passkeys and server records are not deleted.',
  },
} as const
