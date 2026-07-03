export default function deferCssPlugin() {
  return {
    name: 'vite-plugin-defer-css',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet" crossorigin href="([^"]*element-plus[^"]*)"/g,
        '<link rel="preload" as="style" href="$1" onload="this.onload=null;this.rel=\'stylesheet\'"'
      )
    },
  }
}
