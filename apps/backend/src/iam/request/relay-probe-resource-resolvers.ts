import { platformRelayProbeAccountArn } from "../resources/platform-relay-probe-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformRelayProbeAccountResourceResolver: ResourceResolver = ({ request }) => {
  const id = request.params.accountId;
  if (typeof id !== "string") return undefined;
  try {
    return platformRelayProbeAccountArn(id);
  } catch {
    return undefined;
  }
};
