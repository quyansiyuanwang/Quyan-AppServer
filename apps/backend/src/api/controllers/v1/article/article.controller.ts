import {
  Controller,
  Route,
  Tags,
  Get,
  Post,
  Put,
  Delete,
  Path,
  Body,
  Request,
  Security,
  Middlewares,
  Response,
  SuccessResponse,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { ArticleService } from "@/services/article/article.service";
import type {
  CreateArticleDto,
  UpdateArticleDto,
  ArticleDto,
  ArticleListItemDto,
  PublicArticleIdListDto,
  ReorderArticlesDto,
} from "@/api/dto/article/article.dto";
import type { TypedRequest } from "@/types/express";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import {
  articleIdParamsSchema,
  articleSlugParamsSchema,
  createArticleBodySchema,
  reorderArticlesBodySchema,
  updateArticleBodySchema,
} from "@/api/schema/article/article.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

@Route("v1/articles")
@Tags("Article Management")
export class ArticleController extends Controller {
  private service = ArticleService.getInstance();

  @Post("")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_CREATE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(createArticleBodySchema))
  public async createArticle(@Body() body: CreateArticleDto, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.createArticle(body, request.user!.userId, request);
  }

  @Get("")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_READ, PermissionCheckMode.ALL, "jwt")
  public async listArticles(@Request() request: TypedRequest): Promise<ArticleListItemDto[]> {
    return this.service.listArticles(request.user!.userId);
  }

  @Get("published")
  @Security("jwt")
  public async listPublishedArticles(@Request() request: TypedRequest): Promise<ArticleListItemDto[]> {
    return this.service.listPublishedArticles(request.user!.userId);
  }

  /** Returns the designated default article, or null if none is set */
  @Get("default")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Ok")
  @Response(HttpStatusCode.NoContent, "No Content")
  public async getDefaultArticle(@Request() request: TypedRequest): Promise<ArticleDto | null> {
    return this.service.getDefaultArticle(request.user!.userId);
  }

  @Get("{id}")
  @Security("jwt")
  @Middlewares(validateParams(articleIdParamsSchema))
  public async getArticle(@Path() id: string, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.getArticle(id, request.user!.userId);
  }

  @Get("slug/{slug}")
  @Security("jwt")
  @Middlewares(validateParams(articleSlugParamsSchema))
  public async getArticleBySlug(@Path() slug: string, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.getArticleBySlug(slug, request.user!.userId);
  }

  @Get("public/published")
  public async listPublicArticles(): Promise<ArticleListItemDto[]> {
    return this.service.listPublicArticles();
  }

  @Get("public/ids")
  public async listPublicArticleIds(): Promise<PublicArticleIdListDto> {
    return this.service.listPublicArticleIds();
  }

  @Get("public/default")
  @SuccessResponse(HttpStatusCode.Ok, "Ok")
  @Response(HttpStatusCode.NoContent, "No Content")
  public async getPublicDefaultArticle(): Promise<ArticleDto | null> {
    return this.service.getPublicDefaultArticle();
  }

  @Get("public/{id}")
  @Middlewares(validateParams(articleIdParamsSchema))
  public async getPublicArticle(@Path() id: string): Promise<ArticleDto> {
    return this.service.getPublicArticle(id);
  }

  @Get("public/slug/{slug}")
  @Middlewares(validateParams(articleSlugParamsSchema))
  public async getPublicArticleBySlug(@Path() slug: string): Promise<ArticleDto> {
    return this.service.getPublicArticleBySlug(slug);
  }

  /** Reorder articles by updating their sortOrder */
  @Put("reorder")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_UPDATE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(reorderArticlesBodySchema))
  public async reorderArticles(
    @Body() body: ReorderArticlesDto,
    @Request() request: TypedRequest,
  ): Promise<{ success: boolean }> {
    await this.service.reorderArticles(body.items, request.user!.userId, request);
    return { success: true };
  }

  @Put("{id}")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_UPDATE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(articleIdParamsSchema), validateBody(updateArticleBodySchema))
  public async updateArticle(
    @Path() id: string,
    @Body() body: UpdateArticleDto,
    @Request() request: TypedRequest,
  ): Promise<ArticleDto> {
    return this.service.updateArticle(id, body, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_DELETE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(articleIdParamsSchema))
  public async deleteArticle(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.deleteArticle(id, request.user!.userId, request);
    return { success: true };
  }

  @Post("{id}/publish")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_PUBLISH, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(articleIdParamsSchema))
  public async publishArticle(@Path() id: string, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.publishArticle(id, request.user!.userId, request);
  }

  @Post("{id}/unpublish")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_PUBLISH, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(articleIdParamsSchema))
  public async unpublishArticle(@Path() id: string, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.unpublishArticle(id, request.user!.userId, request);
  }

  /** Set a published article as the default displayed article */
  @Post("{id}/set-default")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_UPDATE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware, validateParams(articleIdParamsSchema))
  public async setDefaultArticle(@Path() id: string, @Request() request: TypedRequest): Promise<ArticleDto> {
    return this.service.setDefaultArticle(id, request.user!.userId, request);
  }

  /** Clear the default article designation */
  @Post("clear-default")
  @Security("jwt")
  @CheckPermission(Permission.ARTICLE_UPDATE, PermissionCheckMode.ALL, "jwt")
  @Middlewares(replayProtectionMiddleware)
  public async clearDefaultArticle(@Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.clearDefaultArticle(request.user!.userId, request);
    return { success: true };
  }
}
