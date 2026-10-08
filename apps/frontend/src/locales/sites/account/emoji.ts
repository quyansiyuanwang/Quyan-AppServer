// Locale bundle: account/emoji.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const emoji = {
  workspace: {
    title: '🧰',
    placeholder: '🪟 📚 🛠️',
    openDocs: '📖 ➕ 🧰',
    restore: '↩️🧰',
    docsShort: '📚',
    swaggerTitle: '🧾',
    emptyTitle: '📂👇',
    emptyDescription: '📚💡🛠️ 👀🪟',
    ticketEyebrow: '🧱',
    ticketTitle: '🎫🪟',
    ticketDescription: '🧪 🎫 📜，📜。',
    ticketIdeasTitle: '💭',
    ticketIdeasDescription: '🧠✨📈',
    ticketBugsTitle: '🐞',
    ticketBugsDescription: '🐞🪜📄',
    ticketRoadmapTitle: '🛣️',
    ticketRoadmapDescription: '📍➡️🔁🧰',
  },
} as const satisfies DeepStringify<typeof en>

export default emoji
