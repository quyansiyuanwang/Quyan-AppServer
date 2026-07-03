import { Permission as FrontendPermission } from '../src/constant/permission.ts'
import { Permission as BackendPermission } from '../../../backend/src/constant/permission.ts'

const _frontendValues = Object.values(FrontendPermission)
const _backendValues = Object.values(BackendPermission)

const frontendKeys = Object.keys(FrontendPermission).filter(k => isNaN(Number(k)))
const backendKeys = Object.keys(BackendPermission).filter(k => isNaN(Number(k)))

// 检查数量
if (frontendKeys.length !== backendKeys.length) {
  console.error(`❌ Permission count mismatch: Frontend(${frontendKeys.length}) vs Backend(${backendKeys.length})`)
  process.exit(1)
}

// 检查键
const missingInBackend = frontendKeys.filter(k => !backendKeys.includes(k))
const missingInFrontend = backendKeys.filter(k => !frontendKeys.includes(k))

if (missingInBackend.length > 0) {
  console.error(`❌ Missing in backend: ${missingInBackend.join(', ')}`)
  process.exit(1)
}

if (missingInFrontend.length > 0) {
  console.error(`❌ Missing in frontend: ${missingInFrontend.join(', ')}`)
  process.exit(1)
}

// 检查值
for (const key of frontendKeys) {
  if (FrontendPermission[key] !== BackendPermission[key]) {
    console.error(`❌ Value mismatch for ${key}: Frontend(${FrontendPermission[key]}) vs Backend(${BackendPermission[key]})`)
    process.exit(1)
  }
}

console.log('✅ Permission enums are synchronized between frontend and backend')
