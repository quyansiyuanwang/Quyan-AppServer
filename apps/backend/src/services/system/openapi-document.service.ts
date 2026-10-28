import { env } from "@/config/env";
import { isLocalRequest } from "@/middleware/auth/local_auth";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { OpenApiDocumentRepository } from "@/store/system/openapi-document.repository";
import { PlatformManagementReadIamService } from "./platform-management-read-iam.service";
import type { TypedRequest } from "@/types/express";
export class OpenApiDocumentService {
  private static instance: OpenApiDocumentService;
  private constructor(
    private readonly repository = OpenApiDocumentRepository.getInstance(),
    private readonly iamReads = PlatformManagementReadIamService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OpenApiDocumentService());
  }
  async read(request: TypedRequest): Promise<Record<string, unknown>> {
    // Preserve the local-or-jwt scheme's existing trusted loopback access in non-test environments.
    if (!env.runtime.isTest && isLocalRequest(request)) return this.repository.read();
    return this.iamReads.read("quyan:system:GetOpenApiSpecification", platformSystemArn("openapi-spec"), request, () =>
      this.repository.read(),
    );
  }
}
