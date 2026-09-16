// Runtime helper imports bypass unplugin-element-plus, so their component CSS
// is loaded explicitly from the application entry. Keep these style-only
// imports out of elementPlusRuntime.ts so non-UI Node environments do not need
// to resolve external CSS files.
import 'element-plus/es/components/card/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/notification/style/css'
