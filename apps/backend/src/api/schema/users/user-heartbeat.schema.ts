import { z } from "zod";

export const heartbeatBodySchema = z.preprocess((value) => value ?? {}, z.object({}));
