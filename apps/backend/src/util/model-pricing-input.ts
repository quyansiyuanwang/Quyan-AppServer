import { z } from "zod";
import { RELAY_REQUEST_FORMATS } from "@quyan/shared";
import type { ModelPricing } from "@prisma/client";
import {
  createModelPricingBodySchema,
  updateModelPricingBodySchema,
  importModelPricingBodySchema,
} from "@/api/schema/relay/model-pricing.schema";
import { BadRequestError } from "./errors";
const createSchema = createModelPricingBodySchema
  .extend({ pricingType: z.enum(["token-based", "per-request"]) })
  .strict();
function invalid(): never {
  throw new BadRequestError("Invalid model pricing input", undefined, { messageKey: "errors.badRequest" });
}
function formats(value: string | undefined) {
  if (value && value.split(",").some((format) => !(RELAY_REQUEST_FORMATS as readonly string[]).includes(format.trim())))
    invalid();
}
export function normalizeModelPricingCreate(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) invalid();
  const data = parsed.data;
  formats(data.supportedFormats);
  if (data.pricingType === "per-request" && data.fixedPrice === undefined) invalid();
  return data;
}
export function normalizeModelPricingUpdate(input: unknown, current?: ModelPricing) {
  const parsed = updateModelPricingBodySchema.strict().safeParse(input);
  if (!parsed.success) invalid();
  const data = parsed.data;
  formats(data.supportedFormats);
  if (current) {
    const type = data.pricingType ?? current.pricingType;
    if (!["token-based", "per-request"].includes(type)) invalid();
    const fixedPrice = data.fixedPrice ?? current.fixedPrice;
    if (
      type === "per-request" &&
      (fixedPrice == null || !Number.isFinite(Number(fixedPrice)) || Number(fixedPrice) < 0)
    )
      invalid();
  }
  return data;
}

export function normalizeModelPricingImportBatch(input: unknown) {
  const parsed = importModelPricingBodySchema.safeParse({ models: input });
  if (!parsed.success) invalid();
  parsed.data.models.forEach((item) => formats(item.supportedFormats));
  return parsed.data.models;
}
