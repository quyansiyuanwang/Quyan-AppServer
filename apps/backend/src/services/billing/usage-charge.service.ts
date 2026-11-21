import { RelayProxyRepository } from "@/store/relay/relay-proxy.repository";
import type {
  RelayBalanceChargeMode,
  RelayFinalizeChargeInput,
  RelayProxyStore,
} from "@/store/relay/relay-proxy.store";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { DistributedLockService } from "@/services/infrastructure/distributed-lock.service";
import { BalanceOverdraftRepository } from "@/store/billing/balance-overdraft.repository";
import type { BalanceOverdraftCategory } from "@quyan/shared";
import { Decimal } from "@prisma/client/runtime/library";

interface CoverageOrBalanceCheckInput {
  userId: string;
  modelName: string;
  channelId: string;
  at?: Date;
  category?: BalanceOverdraftCategory;
}

export interface UnifiedUsageChargeInput extends RelayFinalizeChargeInput {
  balanceChargeMode?: RelayBalanceChargeMode;
}

export class UsageChargeService {
  private static instance: UsageChargeService;

  private constructor(
    private readonly relayProxyRepository: RelayProxyStore = RelayProxyRepository.getInstance(),
    private readonly monthlyPassService: MonthlyPassService = MonthlyPassService.getInstance(),
    private readonly distributedLockService: DistributedLockService = DistributedLockService.getInstance(),
    private readonly overdraft = BalanceOverdraftRepository.getInstance(),
  ) {}

  public static getInstance(): UsageChargeService {
    if (!UsageChargeService.instance) UsageChargeService.instance = new UsageChargeService();

    return UsageChargeService.instance;
  }

  async hasCoverageOrPositiveBalance(input: CoverageOrBalanceCheckInput): Promise<boolean> {
    const at = input.at || new Date();

    const hasActiveCoverage = await this.monthlyPassService.hasActiveCoverage(
      input.userId,
      input.modelName,
      input.channelId,
      at,
    );

    if (hasActiveCoverage) return true;

    const balanceAccount = await this.relayProxyRepository.findBalanceAccountByUserId(input.userId);
    if (balanceAccount && balanceAccount.status != null && balanceAccount.status !== 1) return false;
    if (Number(balanceAccount?.balance ?? 0) > 0) return true;
    const policy = await this.overdraft.resolve(balanceAccount);
    const admitted =
      policy.categories.includes(input.category ?? "relay") &&
      new Decimal(balanceAccount?.balance ?? 0).plus(policy.limit).gt(0);
    if (admitted && !balanceAccount) await this.overdraft.initialize(input.userId);
    return admitted;
  }

  async chargeUsage(input: UnifiedUsageChargeInput): Promise<{ applied: boolean }> {
    const lockKey = DistributedLockService.buildKey("billing", "charge", "user", input.userId);

    return this.distributedLockService.runWithLock(
      lockKey,
      async () =>
        this.relayProxyRepository.finalizeChargedUsage({
          ...input,
          balanceChargeMode: input.balanceChargeMode || "strict",
        }),
      {
        ttlMs: 15000,
        acquireTimeoutMs: 5000,
        retryIntervalMs: 100,
      },
    );
  }
}
