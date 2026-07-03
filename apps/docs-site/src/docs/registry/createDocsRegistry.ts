import type {
  DocsLocale,
  DocsPage,
  DocsPageModule,
  DocsRegistry,
  DocsRegistryBuilder,
} from "@/docs/types";

const normalizeLocale = (locale?: string | null): DocsLocale => {
  return locale === "en" ? "en" : "zh-CN";
};

export const createDocsRegistry = (options: {
  defaultSlug: string;
  register: (builder: DocsRegistryBuilder) => void;
}): DocsRegistry => {
  const pages: DocsPage[] = [];
  const pageBySlug = new Map<string, DocsPage>();

  const builder: DocsRegistryBuilder = {
    registerPage(page: DocsPageModule) {
      if (pageBySlug.has(page.slug)) {
        throw new Error(`Duplicate docs slug registered: ${page.slug}`);
      }

      pages.push(page);
      pageBySlug.set(page.slug, page);
    },
  };

  options.register(builder);

  const defaultPage = pageBySlug.get(options.defaultSlug);
  if (!defaultPage) {
    throw new Error(`Missing default docs slug: ${options.defaultSlug}`);
  }

  const pageSlugs = pages.map((page) => page.slug);

  return {
    pages,
    pageSlugs,
    defaultSlug: defaultPage.slug,
    normalizeLocale,
    hasPage(slug?: string | null) {
      return !!slug && pageBySlug.has(slug);
    },
    getPage(slug?: string | null) {
      return (slug ? pageBySlug.get(slug) : undefined) ?? defaultPage;
    },
    getGroupedPages(locale: DocsLocale) {
      const groups = new Map<string, DocsPage[]>();

      for (const page of pages) {
        const key = page.category[locale];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(page);
      }

      return Array.from(groups.entries()).map(([label, groupedPages]) => ({
        label,
        pages: groupedPages,
      }));
    },
    search(keyword: string, locale: DocsLocale) {
      const normalizedKeyword = keyword.trim().toLowerCase();
      if (!normalizedKeyword) return pages;

      return pages.filter((page) => {
        const haystack = [
          page.slug,
          page.category[locale],
          page.title[locale],
          page.summary[locale],
          page.tags.join(" "),
          page.content[locale],
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedKeyword);
      });
    },
  };
};
