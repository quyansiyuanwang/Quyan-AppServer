export default function deferCssPlugin() {
  return {
    name: 'vite-plugin-defer-css',
    transformIndexHtml(html) {
      return html.replace(/<link rel="stylesheet"([^>]*?)href="([^"]+\.css)"([^>]*)>/g, (tag, beforeHref, href, afterHref) => {
        if (!href.startsWith('/assets/')) {
          return tag
        }

        const preloadTag = `<link rel="preload" as="style"${beforeHref}href="${href}"${afterHref} onload="this.onload=null;this.rel='stylesheet'">`
        return `${preloadTag}<noscript>${tag}</noscript>`
      })
    },
  }
}
