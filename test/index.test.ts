import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vitePluginUmami } from "../src/index.js";
import type { Plugin } from "vite";

vi.mock("node:fs/promises", () => ({
    default: { readFile: vi.fn() },
}));

import fs from "node:fs/promises";

const BASE = { hostUrl: "https://umami.example.com", websiteId: "abc-123" };

function invokeHook(plugin: Plugin, ctx = { warn: vi.fn() }) {
    const raw = plugin.transformIndexHtml;
    const fn = typeof raw === "function" ? raw : raw!.handler;
    return (fn as Function).call(ctx, "", { path: "/", filename: "index.html" });
}

function mockFetchOk(body: string) {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status: 200 }));
}

function mockFetchFail() {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
});

describe("validation", () => {
    it("throws if hostUrl is empty", () => {
        expect(() => vitePluginUmami({ ...BASE, hostUrl: "" })).toThrow("`hostUrl` is required");
    });

    it("throws if hostUrl is whitespace", () => {
        expect(() => vitePluginUmami({ ...BASE, hostUrl: "   " })).toThrow("`hostUrl` is required");
    });

    it("throws if websiteId is empty", () => {
        expect(() => vitePluginUmami({ ...BASE, websiteId: "" })).toThrow("`websiteId` is required");
    });

    it("throws if websiteId is whitespace", () => {
        expect(() => vitePluginUmami({ ...BASE, websiteId: "  " })).toThrow("`websiteId` is required");
    });
});

describe("enabled", () => {
    it("returns [] and skips fetch when enabled=false", async () => {
        const result = await invokeHook(vitePluginUmami({ ...BASE, enabled: false }));
        expect(result).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("returns [] and skips fetch when enabled fn returns false", async () => {
        const result = await invokeHook(vitePluginUmami({ ...BASE, enabled: () => false }));
        expect(result).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("proceeds when enabled fn returns true", async () => {
        mockFetchOk("analytics();");
        const result = await invokeHook(vitePluginUmami({ ...BASE, enabled: () => true }));
        expect(result).toHaveLength(1);
    });
});

describe("HTTPS warning", () => {
    it("calls this.warn for http:// hostUrl", async () => {
        mockFetchOk("analytics();");
        const ctx = { warn: vi.fn() };
        await invokeHook(vitePluginUmami({ ...BASE, hostUrl: "http://umami.example.com" }), ctx);
        expect(ctx.warn).toHaveBeenCalledOnce();
        expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("HTTPS"));
    });

    it("does not call this.warn for https:// hostUrl", async () => {
        mockFetchOk("analytics();");
        const ctx = { warn: vi.fn() };
        await invokeHook(vitePluginUmami({ ...BASE }), ctx);
        expect(ctx.warn).not.toHaveBeenCalled();
    });
});

describe("fetch success", () => {
    it("returns tag with correct shape and injected script", async () => {
        mockFetchOk("umami();");
        const [tag] = await invokeHook(vitePluginUmami({ ...BASE }));
        expect(tag.tag).toBe("script");
        expect(tag.injectTo).toBe("head");
        expect(tag.attrs).toMatchObject({
            defer: true,
            "data-website-id": BASE.websiteId,
            "data-host-url": BASE.hostUrl,
        });
        expect(tag.children).toBe("umami();");
    });

    it("uses custom scriptName in the fetch URL", async () => {
        mockFetchOk("umami();");
        await invokeHook(vitePluginUmami({ ...BASE, scriptName: "tracker.js" }));
        expect(fetch).toHaveBeenCalledWith(expect.stringContaining("tracker.js"), expect.any(Object));
    });

    it("verbose=true logs fetched size and duration", async () => {
        mockFetchOk("umami();");
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        await invokeHook(vitePluginUmami({ ...BASE, verbose: true }));
        expect(spy).toHaveBeenCalledWith(expect.stringMatching(/fetched.*bytes.*ms/));
        spy.mockRestore();
    });
});

describe("retries", () => {
    it("retries and succeeds on second attempt", async () => {
        mockFetchFail();
        mockFetchOk("umami();");
        const result = await invokeHook(vitePluginUmami({ ...BASE, retries: 1 }));
        expect(result).toHaveLength(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("returns [] and logs error after exhausting retries (no fallback)", async () => {
        mockFetchFail();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const result = await invokeHook(vitePluginUmami({ ...BASE, retries: 0 }));
        expect(result).toEqual([]);
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });
});

describe("fallback", () => {
    it("uses fallbackPath when all fetches fail", async () => {
        mockFetchFail();
        vi.mocked(fs.readFile).mockResolvedValueOnce("fallback script" as any);
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const [tag] = await invokeHook(vitePluginUmami({ ...BASE, retries: 0, fallbackPath: "./umami.js" }));
        expect(tag.children).toBe("fallback script");
        spy.mockRestore();
    });

    it("verbose=true logs fallback path", async () => {
        mockFetchFail();
        vi.mocked(fs.readFile).mockResolvedValueOnce("fallback script" as any);
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await invokeHook(vitePluginUmami({ ...BASE, retries: 0, fallbackPath: "./umami.js", verbose: true }));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("./umami.js"));
        consoleSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("returns [] when fallbackPath read fails", async () => {
        mockFetchFail();
        vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"));
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const result = await invokeHook(vitePluginUmami({ ...BASE, retries: 0, fallbackPath: "./umami.js" }));
        expect(result).toEqual([]);
        spy.mockRestore();
    });
});

describe("error conditions", () => {
    it("handles AbortError (timeout) gracefully and returns []", async () => {
        const err = new DOMException("aborted", "AbortError");
        vi.mocked(fetch).mockRejectedValueOnce(err);
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const result = await invokeHook(vitePluginUmami({ ...BASE, retries: 0 }));
        expect(result).toEqual([]);
        spy.mockRestore();
    });

    it("treats non-OK HTTP status as failure and returns []", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const result = await invokeHook(vitePluginUmami({ ...BASE, retries: 0 }));
        expect(result).toEqual([]);
        spy.mockRestore();
    });
});
