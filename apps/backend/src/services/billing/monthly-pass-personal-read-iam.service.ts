import { IamPersonalCollectionService } from "@/iam/collection/personal-collection.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import { MonthlyPassPersonalReadRepository } from "@/store/billing/monthly-pass-personal-read.repository";
import type {
  MonthlyPassPersonalReadStore,
  MonthlyPassPersonalReadView,
} from "@/store/billing/monthly-pass-personal-read.store";
export class MonthlyPassPersonalReadIamService extends IamPersonalCollectionService<MonthlyPassPersonalReadView> {
  private static instance: MonthlyPassPersonalReadIamService;
  static getInstance() {
    return (this.instance ??= new MonthlyPassPersonalReadIamService());
  }
  constructor(
    iam: Pick<IamAuthorizationService, "loadPolicies" | "authorizeMany"> = IamAuthorizationService.getInstance(),
    repository: MonthlyPassPersonalReadStore = MonthlyPassPersonalReadRepository.getInstance(),
    users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
  ) {
    super("quyan:monthly_pass:ListMyPasses", iam, repository, users);
  }
}
