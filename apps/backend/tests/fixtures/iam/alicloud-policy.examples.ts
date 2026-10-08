import type { IamPolicyDocument } from "@quyan/shared";

/**
 * Cross-cloud syntax fixture only. These actions are intentionally not part
 * of the production Quyan Action Catalog and must not be used for live route
 * metadata or authorization simulation.
 */
export const alicloudDnsPolicyExample = {
  Version: "1",
  Statement: [
    {
      Sid: "ManageDnsRecordsForSelectedDomains",
      Effect: "Allow",
      Action: [
        "alidns:AddDomainRecord",
        "alidns:UpdateDomainRecord",
        "alidns:DeleteDomainRecord",
        "alidns:SetDomainRecordStatus",
        "alidns:DescribeDomainRecords",
        "alidns:DescribeDomainRecordInfo",
        "alidns:DescribeSubDomainRecords",
      ],
      Resource: ["acs:alidns:*:*:domain/qrmr.cn", "acs:alidns:*:*:domain/api.taoliya.qysyw.cn"],
    },
    {
      Sid: "DescribeDnsDomains",
      Effect: "Allow",
      Action: ["alidns:DescribeDomains", "alidns:DescribeDomainInfo"],
      Resource: "*",
    },
  ],
} satisfies IamPolicyDocument;
