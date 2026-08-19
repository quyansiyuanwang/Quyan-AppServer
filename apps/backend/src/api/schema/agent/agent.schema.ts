import { z } from "zod";

export const createAgentWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  policy: z
    .object({
      allowedCommands: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
      allowedPaths: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
      allowedHosts: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
      autoApproveReadOnly: z.boolean().optional(),
    })
    .optional(),
  limits: z
    .object({
      cpu: z.number().int().min(1).max(16).optional(),
      memoryMb: z.number().int().min(128).max(65536).optional(),
      diskMb: z.number().int().min(128).max(1048576).optional(),
      timeoutSeconds: z.number().int().min(30).max(86400).optional(),
      maxSteps: z.number().int().min(1).max(100).optional(),
      budget: z.number().nonnegative().max(100000).optional(),
    })
    .optional(),
});

export const createAgentRunBodySchema = z.object({
  content: z.string().trim().min(1).max(20000),
  model: z.string().trim().min(1).max(120),
  relayTokenId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1),
  maxSteps: z.number().int().min(1).max(100).optional(),
  budget: z.number().nonnegative().max(100000).optional(),
});

export const decideAgentApprovalBodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export const createMcpServerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  endpoint: z.string().url().max(2048).optional(),
  transport: z.enum(["streamable-http", "sse"]).optional(),
  toolAllowlist: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  credential: z.record(z.string().max(2000)).optional(),
});
