import type { ResourceResolver } from "./resource-resolvers";
import { platformUserDirectoryArn } from "../resources/platform-user-resources";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { Permission } from "@quyan/shared";
/** The server fixes the collection boundary; only a transaction can resolve the new user ID. */
export const platformUserCreateResourceResolver: ResourceResolver = async ({ principal }) => {
  await platformManagementGroupSnapshot(principal, Permission.USER_CREATE);
  return platformUserDirectoryArn();
};
