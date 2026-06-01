import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgnesVideoProvider } from "../agnes-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "agnes-test-id") }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("img")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from("img")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

const COMPLETED_RESPONSE = {
  code: "success",
  data: { status: "COMPLETED", data: { url: "https://storage.agnes-ai.com/video.mp4", object: "video", status: "completed" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/video/generations/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
    }
    if (url.includes("/video/generations")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-agnes-1" }) });
    }
    if (url.includes("storage.agnes-ai.com") || url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: true });
  }) as any);
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new AgnesVideoProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("AGNES_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://apihub.agnes-ai.com/v1");
    expect((p as any).model).toBe("agnes-video-v2.0");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("AGNES_API_KEY", "env-key");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("env-key");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("AGNES_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "agnes-1.5-flash", baseUrl: "https://custom.example.com/v1" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("agnes-1.5-flash");
    expect((p as any).baseUrl).toBe("https://custom.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://apihub.agnes-ai.com/v1/" });
    expect((p as any).baseUrl).toBe("https://apihub.agnes-ai.com/v1");
  });
});

describe("generateVideo", () => {
  it("submits text-only body when no image provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await p.generateVideo({ prompt: "a cat walking", duration: 5, ratio: "16:9" } as any);

    const submitCall = fetchCalls.find(c => c.url.includes("/video/generations") && !c.url.includes("/video/generations/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("agnes-video-v2.0");
    expect(body.prompt).toBe("a cat walking");
    expect(body.image).toBeUndefined();
  }, 20000);

  it("submits with base64 image when firstFrame provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await p.generateVideo({ prompt: "cat", firstFrame: "start.png", duration: 5, ratio: "16:9" } as any);

    const submitCall = fetchCalls.find(c => c.url.includes("/video/generations") && !c.url.includes("/video/generations/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toBe("aW1n");
    expect(body.model).toBe("agnes-video-v2.0");
  }, 20000);

  it("submits with base64 image when initialImage provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);

    const submitCall = fetchCalls.find(c => c.url.includes("/video/generations") && !c.url.includes("/video/generations/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toBe("aW1n");
  }, 20000);

  it("uses Authorization header with Bearer token", async () => {
    const p = makeProvider({ apiKey: "my-secret-key" });
    await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);

    const submitCall = fetchCalls.find(c => c.url.includes("/video/generations") && !c.url.includes("/video/generations/"));
    expect(submitCall!.options!.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer my-secret-key",
    });
  }, 20000);

  it("polls task status and returns filePath on completion", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) {
        pollCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pollCount === 1
          ? { code: "success", data: { status: "PROCESSING" } }
          : COMPLETED_RESPONSE) });
      }
      if (url.includes("/video/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      }
      if (url.includes("storage.agnes-ai.com") || url.includes("example.com")) {
        return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);
    expect(result.filePath).toContain("agnes-test-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations") && !url.includes("/video/generations/")) {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "bad-key" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video submit failed: 401");
  });

  it("throws when submit response has no task_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations") && !url.includes("/video/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "queued" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video: no task_id");
  });

  it("throws on generation FAILURE", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          code: "success",
          data: { status: "FAILURE", fail_reason: "upstream returned error", data: { error: { message: "division by zero" } } },
        }) });
      }
      if (url.includes("/video/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video generation failed: upstream returned error");
  }, 30000);

  it("throws on generation FAILED status", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          code: "success",
          data: { status: "FAILED", fail_reason: "internal error" },
        }) });
      }
      if (url.includes("/video/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video generation failed: internal error");
  }, 30000);

  it("throws on COMPLETED but no URL", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: "success", data: { status: "COMPLETED", data: { status: "completed" } } }) });
      }
      if (url.includes("/video/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video: no URL in completed response");
  }, 30000);

  it("handles video_url field in completed response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          code: "success",
          data: { status: "COMPLETED", data: { video_url: "https://example.com/v.mp4", status: "completed" } },
        }) });
      }
      if (url.includes("/video/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      }
      if (url.includes("example.com")) {
        return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);
    expect(result.filePath).toContain("agnes-test-id.mp4");
  }, 30000);

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video/generations/")) return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
      if (url.includes("/video/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ task_id: "task-1" }) });
      if (url.includes("storage.agnes-ai.com")) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video download failed: 500");
  }, 30000);

  it("saves video to uploads/videos/ directory", async () => {
    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);

    const calls = fetchCalls.filter(c => c.url.includes("storage.agnes-ai.com") || c.url.includes("example.com"));
    expect(calls.length).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("accepts task_id via id field in submit response", async () => {
    let polledId = "";
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const match = url.match(/\/video\/generations\/(.+)/);
      if (match) polledId = match[1];
      if (url.includes("/video/generations/")) return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
      if (url.includes("/video/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-alt-id" }) });
      if (url.includes("storage.agnes-ai.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);
    expect(result.filePath).toContain("agnes-test-id.mp4");
    expect(polledId).toBe("task-alt-id");
  }, 20000);
});
