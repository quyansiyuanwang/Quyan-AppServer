export type DocsLocale = "en" | "zh-CN";

export interface DocsPage {
  slug: string;
  category: Record<DocsLocale, string>;
  title: Record<DocsLocale, string>;
  summary: Record<DocsLocale, string>;
  tags: string[];
  updatedAt: string;
  content: Record<DocsLocale, string>;
}

export type DocsPageInput = Omit<DocsPage, "updatedAt"> & {
  updatedAt?: string;
};

export type DocsPageModule = DocsPage;

export interface DocsRegistryBuilder {
  registerPage(page: DocsPageModule): void;
}

export interface DocsRegistry {
  pages: DocsPage[];
  pageSlugs: DocsPage["slug"][];
  defaultSlug: DocsPage["slug"];
  normalizeLocale(locale?: string | null): DocsLocale;
  hasPage(slug?: string | null): boolean;
  getPage(slug?: string | null): DocsPage;
  getGroupedPages(locale: DocsLocale): Array<{
    label: string;
    pages: DocsPage[];
  }>;
  search(keyword: string, locale: DocsLocale): DocsPage[];
}
