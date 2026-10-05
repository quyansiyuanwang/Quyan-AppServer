// Locale bundle: console-ai/emoji.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji: DeepStringify<typeof en> = {
  productConfig: {
    titleSuffix: '⚙️',
    description: '🚦 🎁 💰',
    serviceSwitch: '🚦',
    serviceSwitchDescription: '⏸️ ➜ 🌐 📞 🚫；📦 ✅',
    dailyQuota: '📅 🎁',
    overagePrice: '➕ 💰',
    freeUnlimitedHint: '0 💰 ➜ 🆓 ♾️ 📅',
    instanceLimit: '📦 🔢',
    loadError: '⚙️ 📥 💥',
    saved: '⚙️ 💾 ✅',
  },
  productOperations: {
    titleSuffix: '📊',
    description: '👤 🎁 💰 📦；🛂 🔐 ↔️',
    searchPlaceholder: '🔎 👤 🆔',
    user: '👤',
    userId: '🆔',
    quota: '📅 🎁',
    useDefaultQuota: '⚙️ 🎁',
    overageEnabled: '➕ 💰',
    instanceLimit: '📦 🔢',
    manageUser: '🛠️ 👤',
    accountNotConfigured: '⚙️ ∅',
    accountSettings: '⚙️',
    instances: '📦',
    usage: '📊',
    audit: '📜',
    saveSuccess: '⚙️ 💾 ✅',
  },
  productCatalog: {
    title: '📚',
    description: '🧩 📦 🔑 📜 📊',
    refresh: '♻️ 📚',
    api: '📨',
    managedService: '🛠️',
    quota: '🎁',
    perDay: '/ 📅',
    enter: '➡️ 🧩',
    actions: '🧩 ⚙️',
    noAccess: '🚫',
    disabled: '⏸️',
    available: '✅',
    loadError: '📚 📥 💥，♻️ 🔁',
  },
  productFeedback: {
    loadFailed: '📥 💥，🔁',
    operationFailed: '⚙️ 💥，🔁',
    retry: '🔁',
    formError: '⚠️ ❌ ➜ 🔁',
  },
}

export default emoji
