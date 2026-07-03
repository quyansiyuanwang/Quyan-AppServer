interface BuildInfo {
  version: string
  commitHash: string
  commitHashShort: string
  branch: string
  commitMessage: string
  commitTime: string
  buildTime: string
}

declare const __BUILD_INFO__: BuildInfo
