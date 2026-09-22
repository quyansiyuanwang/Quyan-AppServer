import 'axios'
declare module 'axios' {
  interface AxiosRequestConfig {
    errorPresentation?: 'global' | 'local' | 'silent'
  }
}
