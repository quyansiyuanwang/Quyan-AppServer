import { Controller, Get, Path, Request, Route, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { Permission } from "@/constant/permission";
import { skipResponseWrapper } from "@/util/response-wrapper";
import { extractClientIp } from "@/util/ip-extractor";

@Route("s")
@Tags("Developer Public Short Links")
export class DeveloperShortLinkPublicController extends Controller {
  @Get("{code}")
  public async redirect(@Path() code: string, @Request() request: TypedRequest): Promise<void> {
    const projectService = DeveloperProjectService.getInstance();
    const resolved = await projectService.resolveShortLink(code);
    const target = await DeveloperProductPlatformService.getInstance().executeMeteredForInstance(
      resolved.instanceId,
      "short_link",
      Permission.PRODUCT_SHORT_LINK_READ,
      async () => {
        await projectService.recordShortLinkClick(resolved.linkId, {
          referrer: request.get("referer"),
          userAgent: request.get("user-agent"),
          country: request.get("cf-ipcountry") || request.get("x-vercel-ip-country"),
          ipAddress: extractClientIp(request),
        });
        return resolved.targetUrl;
      },
    );
    skipResponseWrapper(request);
    request.res.redirect(302, target);
  }
}

@Route("status")
@Tags("Developer Public Status")
export class DeveloperStatusPublicController extends Controller {
  @Get("{slug}")
  public async status(@Path() slug: string) {
    return DeveloperProjectService.getInstance().getPublicStatusPage(slug);
  }
}
