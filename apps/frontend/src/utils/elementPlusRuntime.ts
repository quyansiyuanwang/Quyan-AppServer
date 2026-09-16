// Runtime helper imports must carry their component CSS explicitly. Alias
// exports are invisible to unplugin-element-plus, so importing only the JS
// module leaves MessageBox/Message/Notification/Card rendered without styles.
import 'element-plus/es/components/card/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/notification/style/css'

// Import Element Plus runtime helpers from their concrete modules. The package
// root re-exports the full component library, which prevents route-level
// tree-shaking when a page only needs a message or notification API.
export { ElCard } from 'element-plus/es/components/card/index'
export { ElMessage } from 'element-plus/es/components/message/index'
export { ElMessageBox } from 'element-plus/es/components/message-box/index'
export { ElNotification } from 'element-plus/es/components/notification/index'
