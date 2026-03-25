import fs from "node:fs/promises";
import type { Plugin } from "vite";

export interface VitePluginUmamiOptions {
  scriptUrl?: string;
  websiteId: string;
  fallbackPath?: string;
  fetchTimeout?: number;
  retries?: number;
  enabled?: boolean | ((env: Record<string, string>) => boolean);
  verbose?: boolean;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "vite-build" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export function vitePluginUmami(options: VitePluginUmamiOptions): Plugin {
  const {
    scriptUrl = "https://cloud.umami.is/script.js",
    websiteId,
    fallbackPath,
    fetchTimeout = 5000,
    retries = 1,
    enabled = true,
    verbose = false,
  } = options;

  if (!scriptUrl || scriptUrl.trim() === "") {
    throw new Error(
      "[vite-plugin-umami-inline] `scriptUrl` must not be empty.",
    );
  }
  if (!websiteId || websiteId.trim() === "") {
    throw new Error(
      "[vite-plugin-umami-inline] `websiteId` is required and must not be empty.",
    );
  }

  const parsedUrl = new URL(scriptUrl);
  const hostUrl = parsedUrl.origin;
  const scriptName = parsedUrl.pathname.split("/").filter(Boolean).pop() ?? "script.js";

  return {
    name: "vite-plugin-umami-inline",
    apply: "build",

    async transformIndexHtml() {
      const isEnabled =
        typeof enabled === "function"
          ? enabled(process.env as Record<string, string>)
          : enabled;

      if (!isEnabled) return [];

      if (!scriptUrl.startsWith("https://")) {
        this.warn(
          "[vite-plugin-umami-inline] `scriptUrl` does not use HTTPS — analytics may be blocked.",
        );
      }
      let script: string | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const start = Date.now();
          const res = await fetchWithTimeout(scriptUrl, fetchTimeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          script = await res.text();
          if (verbose) {
            const ms = Date.now() - start;
            console.log(
              `[vite-plugin-umami-inline] fetched ${scriptName} (${Buffer.byteLength(script)} bytes) in ${ms}ms`,
            );
          }
          break;
        } catch (e) {
          const isLast = attempt === retries;
          if (isLast) {
            console.error(
              `[vite-plugin-umami-inline] fetch failed after ${retries + 1} attempt(s):`,
              e,
            );
          }
        }
      }

      if (script === null && fallbackPath) {
        try {
          script = await fs.readFile(fallbackPath, "utf-8");
          if (verbose) {
            console.log(
              `[vite-plugin-umami-inline] using fallback file: ${fallbackPath}`,
            );
          }
        } catch (e) {
          console.error(
            `[vite-plugin-umami-inline] fallback file read failed (${fallbackPath}):`,
            e,
          );
        }
      }

      if (script === null) return [];

      return [
        {
          tag: "script",
          attrs: {
            defer: true,
            "data-website-id": websiteId,
            "data-host-url": hostUrl,
          },
          children: script,
          injectTo: "head" as const,
        },
      ];
    },
  };
}
