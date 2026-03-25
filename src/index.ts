import fs from "node:fs/promises";
import type { Plugin } from "vite";

export interface VitePluginUmamiOptions {
  hostUrl: string;
  websiteId: string;
  scriptName?: string;
  fallbackPath?: string;
  fetchTimeout?: number;
  retries?: number;
  enabled?: boolean | ((env: Record<string, string>) => boolean);
  verbose?: boolean;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
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
    hostUrl,
    websiteId,
    scriptName = "script.js",
    fallbackPath,
    fetchTimeout = 5000,
    retries = 1,
    enabled = true,
    verbose = false,
  } = options;

  if (!hostUrl || hostUrl.trim() === "") {
    throw new Error("[vite-plugin-umami] `hostUrl` is required and must not be empty.");
  }
  if (!websiteId || websiteId.trim() === "") {
    throw new Error("[vite-plugin-umami] `websiteId` is required and must not be empty.");
  }

  return {
    name: "vite-plugin-umami",
    apply: "build",

    async transformIndexHtml() {
      const isEnabled =
        typeof enabled === "function"
          ? enabled(process.env as Record<string, string>)
          : enabled;

      if (!isEnabled) return [];

      if (!hostUrl.startsWith("https://")) {
        this.warn("[vite-plugin-umami] `hostUrl` does not use HTTPS — analytics may be blocked.");
      }

      const scriptUrl = `${hostUrl}/${scriptName}`;
      let script: string | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const start = Date.now();
          const res = await fetchWithTimeout(scriptUrl, fetchTimeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          script = await res.text();
          if (verbose) {
            const ms = Date.now() - start;
            console.log(`[vite-plugin-umami] fetched ${scriptName} (${Buffer.byteLength(script)} bytes) in ${ms}ms`);
          }
          break;
        } catch (e) {
          const isLast = attempt === retries;
          if (isLast) {
            console.error(`[vite-plugin-umami] fetch failed after ${retries + 1} attempt(s):`, e);
          }
        }
      }

      if (script === null && fallbackPath) {
        try {
          script = await fs.readFile(fallbackPath, "utf-8");
          if (verbose) {
            console.log(`[vite-plugin-umami] using fallback file: ${fallbackPath}`);
          }
        } catch (e) {
          console.error(`[vite-plugin-umami] fallback file read failed (${fallbackPath}):`, e);
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
