import fs from "fs-extra";
import { SWAGGER_PATH } from "@/constant/file-path";
/** Always read the generated specification from the server-owned path. */
export class OpenApiDocumentRepository {
  private static instance: OpenApiDocumentRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new OpenApiDocumentRepository());
  }
  async read(): Promise<Record<string, unknown>> {
    const document: unknown = await fs.readJson(SWAGGER_PATH);
    if (!document || typeof document !== "object" || Array.isArray(document))
      throw new Error("Generated OpenAPI specification is invalid");
    return document as Record<string, unknown>;
  }
}
