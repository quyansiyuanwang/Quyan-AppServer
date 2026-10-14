import type { ResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformTemplateArn, platformTerminalTemplateControlArn } from "../resources/platform-template-resources";
export const platformTerminalTemplateCreateResource: ResourceResolver = () => platformTerminalTemplateControlArn();
/** The endpoint declares the action; untrusted IDs only select a validated platform template ARN. */
export const platformTerminalTemplateWriteResource: ResourceResolver = ({ request }) => {
  const id = request.params.id;
  return isPlatformLogResourceId(id) ? platformTemplateArn("remote-terminal", id) : undefined;
};
