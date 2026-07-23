import { Controller, Get, Path, Request, Route, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import { skipResponseWrapper } from "@/util/response-wrapper";

@Route("s")
@Tags("Developer Public Short Links")
export class DeveloperShortLinkPublicController extends Controller {
  @Get("{code}")
  public async redirect(@Path() code: string, @Request() request: TypedRequest): Promise<void> {
    const target = await DeveloperProjectService.getInstance().resolveShortLink(code, {
      referrer: request.get("referer"),
      userAgent: request.get("user-agent"),
      country: request.get("cf-ipcountry") || request.get("x-vercel-ip-country"),
    });
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
