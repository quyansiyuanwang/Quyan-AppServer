import type { DocsRegistryBuilder } from "@/docs/types";
import { registerIntroDocs } from "./intro";
import { registerAccessDocs } from "./access";
import { registerContentDocs } from "./content";
import { registerChatDocs } from "./chat";
import { registerAccountDocs } from "./account";
import { registerAdminDocs } from "./admin";
import { registerRelayDocs } from "./relay";
import { registerReferenceDocs } from "./reference";
import { registerToolsDocs } from "./tools";
import { registerSystemDocs } from "./system";
import { registerOjDocs } from "./oj";
import { registerOtherDocs } from "./other";

export const registerAllDocs = (registry: DocsRegistryBuilder) => {
  registerIntroDocs(registry);
  registerAccessDocs(registry);
  registerContentDocs(registry);
  registerChatDocs(registry);
  registerAccountDocs(registry);
  registerAdminDocs(registry);
  registerRelayDocs(registry);
  registerReferenceDocs(registry);
  registerToolsDocs(registry);
  registerSystemDocs(registry);
  registerOjDocs(registry);
  registerOtherDocs(registry);
};
