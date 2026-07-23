import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";

/** The service boundary for project-scoped developer capabilities. */
export class DeveloperProjectService extends DeveloperProjectRepository {
  private static serviceInstance: DeveloperProjectService;

  static getInstance(): DeveloperProjectService {
    if (!this.serviceInstance) this.serviceInstance = new DeveloperProjectService();
    return this.serviceInstance;
  }
}
