const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

const backendBaseUrl = trimTrailingSlash(
  import.meta.env.VITE_BACKEND_URL || window.location.origin,
);

export const APP_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_APP_BASE_URL || "https://qysyw.cn",
);
export const DOCS_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_APP_DOCS_BASE_URL || window.location.origin,
);
export const SWAGGER_DOCS_URL = trimTrailingSlash(
  import.meta.env.VITE_SWAGGER_DOCS_URL || `${backendBaseUrl}/docs`,
);

const tokenMap = {
  APP_BASE_URL,
  DOCS_BASE_URL,
  SWAGGER_DOCS_URL,
} as const;

export const interpolateDocsContent = (content: string) => {
  return content.replace(
    /\{\{(APP_BASE_URL|DOCS_BASE_URL|SWAGGER_DOCS_URL)\}\}/g,
    (_, key) => {
      return tokenMap[key as keyof typeof tokenMap];
    },
  );
};
