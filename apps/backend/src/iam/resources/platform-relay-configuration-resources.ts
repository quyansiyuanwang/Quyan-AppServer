import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
/** One platform configuration resource, independent of database revision/row replacement. */
export function platformRelayConfigurationArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-configuration/default",
  });
}

/** The handler admits every affected pricing ARN inside the write transaction. */
export function platformRelayConfigurationWriteResources() {
  return [platformRelayConfigurationArn()];
}
