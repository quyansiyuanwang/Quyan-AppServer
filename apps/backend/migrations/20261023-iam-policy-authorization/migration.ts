import { parseArgs } from "node:util";

export interface IamMigrationReport {
  planned: number;
  migrated: number;
  invalid: number;
  changed: number;
}
export interface IamDeploymentMigrationStore {
  listAccounts(afterId?: string): Promise<string[]>;
  validateSources(accountOwnerId?: string): Promise<number>;
}
export interface IamMigrationTask {
  run(options: { accountOwnerId: string; apply?: boolean }): Promise<IamMigrationReport>;
}
export type IamDeploymentMigrationOptions = {
  apply: boolean;
  allAccounts: boolean;
  accountOwnerId?: string;
};
export type IamDeploymentMigrationEvent = {
  stage: "preflight" | "apply" | "verify";
  accountOwnerId?: string;
  source?: "sources" | "policies" | "authorizations";
  invalid?: number;
  report?: IamMigrationReport;
};
export class IamDeploymentMigrationError extends Error {
  constructor(
    public readonly code: "invalid-scope" | "invalid-sources" | "invalid-data" | "source-changed" | "incomplete",
  ) {
    super("IAM deployment migration refused: " + code);
  }
}
export function parseIamDeploymentMigrationArgs(args: string[]): IamDeploymentMigrationOptions {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      apply: { type: "boolean", default: false },
      "all-accounts": { type: "boolean", default: false },
      "account-owner-id": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const options = {
    apply: values.apply!,
    allAccounts: values["all-accounts"]!,
    accountOwnerId: values["account-owner-id"],
  };
  assertScope(options);
  return options;
}
function assertScope(options: IamDeploymentMigrationOptions) {
  if (
    options.allAccounts === (options.accountOwnerId !== undefined) ||
    (options.accountOwnerId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(options.accountOwnerId))
  )
    throw new IamDeploymentMigrationError("invalid-scope");
}
/** Preflight every selected account before the first write; restartable, not a global transaction. */
export class IamDeploymentMigration {
  constructor(
    private readonly store: IamDeploymentMigrationStore,
    private readonly policies: IamMigrationTask,
    private readonly authorizations: IamMigrationTask,
  ) {}
  async run(options: IamDeploymentMigrationOptions, onEvent: (event: IamDeploymentMigrationEvent) => void = () => {}) {
    assertScope(options);
    const accounts: string[] = options.accountOwnerId ? [options.accountOwnerId] : [];
    const seen = new Set(accounts);
    if (options.allAccounts) {
      let afterId: string | undefined;
      for (;;) {
        const page = await this.store.listAccounts(afterId);
        if (!page.length) break;
        for (const id of page) {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || seen.has(id))
            throw new IamDeploymentMigrationError("invalid-scope");
          accounts.push(id);
          seen.add(id);
          afterId = id;
        }
      }
    }
    const sources = async (stage: IamDeploymentMigrationEvent["stage"], accountOwnerId?: string) => {
      const invalid = await this.store.validateSources(accountOwnerId);
      onEvent({ stage, source: "sources", accountOwnerId, invalid });
      if (invalid) throw new IamDeploymentMigrationError("invalid-sources");
    };
    const tasks = async (stage: IamDeploymentMigrationEvent["stage"], accountOwnerId: string) => {
      for (const [source, task] of [
        ["policies", this.policies],
        ["authorizations", this.authorizations],
      ] as const) {
        const report = await task.run({ accountOwnerId, apply: stage === "apply" });
        onEvent({ stage, accountOwnerId, source, report });
        if (report.invalid) throw new IamDeploymentMigrationError("invalid-data");
        if (report.changed) throw new IamDeploymentMigrationError("source-changed");
        if (stage === "verify" && report.planned) throw new IamDeploymentMigrationError("incomplete");
      }
    };
    // Global legacy administrator groups affect all accounts, even a single-account migration.
    await sources("preflight");
    for (const account of accounts) {
      await sources("preflight", account);
      await tasks("preflight", account);
    }
    if (options.apply) {
      for (const account of accounts) {
        await sources("apply", account);
        await tasks("apply", account);
      }
      await sources("verify");
      for (const account of accounts) {
        await sources("verify", account);
        await tasks("verify", account);
      }
    }
    return { mode: options.apply ? "apply" : "dry-run", accounts: accounts.length, verified: options.apply };
  }
}
