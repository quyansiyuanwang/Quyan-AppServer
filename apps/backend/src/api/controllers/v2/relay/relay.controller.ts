import { Get, Route, Security, Tags, Controller, Request, Query, Middlewares } from "@tsoa/runtime";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import type { RelayTokenCurrentQuotaDto, RelayTokenCurrentQuotaQueryDto } from "@/api/dto/relay/relay.dto";
import type { TypedRequest } from "@/types/express";
import { validateQuery } from "@/middleware/validation";
import { relayTokenUsageQuerySchema } from "@/api/schema/relay/relay.schema";
import { UnauthorizedError } from "@/util/errors";

@Route("v2/relay")
@Tags("Relay V2")
export class RelayV2Controller extends Controller {
  private relayTokenService = new RelayTokenService();

  @Get("tokens/current/quota-summary")
  @Security("relay-token")
  @Middlewares(validateQuery(relayTokenUsageQuerySchema))
  async getCurrentTokenQuotaSummary(
    @Request() request: TypedRequest,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() windowHours?: number,
    @Query() resetAt?: string,
    @Query() timezoneOffsetMinutes?: number,
  ): Promise<RelayTokenCurrentQuotaDto> {
    if (!request.relayToken) throw new UnauthorizedError("This endpoint requires a relay token");

    const query: RelayTokenCurrentQuotaQueryDto = {
      startDate,
      endDate,
      windowHours,
      resetAt,
      timezoneOffsetMinutes,
    };

    return this.relayTokenService.getCurrentTokenQuotaSummary(request.relayToken, query);
  }
}
