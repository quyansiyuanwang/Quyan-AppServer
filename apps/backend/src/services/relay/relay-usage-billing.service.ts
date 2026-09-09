import { calculateRelayCost, type RelayCostResult, type RelayCostParams } from "./utils/relay-usage-billing.util";

/** Stateless billing facade used by relay forwarders and the proxy facade. */
export class RelayUsageBillingService {
  calculateCost(params: RelayCostParams): RelayCostResult {
    return calculateRelayCost(params);
  }
}
