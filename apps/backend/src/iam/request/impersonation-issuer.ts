import type { IamPrincipal } from "@quyan/shared";
/** Signed internal JWT claim. Authentication must validate it before using issuer grants. */
export interface ImpersonationIssuer {
  principal: IamPrincipal;
  updatedAt: string;
  accessKeyId?: string;
}
