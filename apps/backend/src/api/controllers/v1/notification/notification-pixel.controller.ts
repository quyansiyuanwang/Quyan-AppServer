import { Get, Path, Route, Tags, Controller, Request, SuccessResponse } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { TypedRequest } from "@/types/express";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { skipResponseWrapper } from "@/util/response-wrapper";

const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7", "base64");

@Route("v1/notification")
@Tags("Notification / Event Center")
export class NotificationPixelController extends Controller {
  private repository = NotificationPreferenceRepository.getInstance();

  /** Email open-tracking pixel: marks the corresponding inbox item as read as a side effect */
  @Get("pixel/{inboxItemId}")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async trackPixel(@Path() inboxItemId: string, @Request() request: TypedRequest): Promise<void> {
    skipResponseWrapper(request);
    const res = request.res;
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).send(TRANSPARENT_GIF);

    this.repository.markInboxItemReadById(inboxItemId).catch(() => {});
  }
}
