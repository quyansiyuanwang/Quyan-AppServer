import {
  buildAcsResource,
  IAM_PLATFORM_ACCOUNT_ID,
  IAM_PLATFORM_TEMPLATE_DEFINITIONS,
  type IamPlatformTemplateKind,
} from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformTemplateDefinition(kind: IamPlatformTemplateKind) {
  const definition = IAM_PLATFORM_TEMPLATE_DEFINITIONS.find((entry) => entry.kind === kind);
  if (!definition) throw new Error("Unknown platform template kind");
  return definition;
}
export function platformTemplateArn(kind: IamPlatformTemplateKind, id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid platform template identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: platformTemplateDefinition(kind).resourceType + "/" + id,
  });
}

export function platformTerminalTemplateControlArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "remote-terminal-template-control",
  });
}
