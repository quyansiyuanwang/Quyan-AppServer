import { Get, Route, SuccessResponse, Response, Tags, Controller } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";

@Route("")
@Tags("Root")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class RootController extends Controller {
  @Get("ping")
  @SuccessResponse(HttpStatusCode.Ok, "pong")
  public async ping(): Promise<{ message: string }> {
    return { message: "pong" };
  }
}
