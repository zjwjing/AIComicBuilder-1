import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComfyUIImageProvider } from "../comfyui-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "mock-id-123") }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@/lib/comfyui/preflight", () => ({
  preflightWorkflow: vi.fn(),
}));

import { preflightWorkflow } from "@/lib/comfyui/preflight";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

describe("ComfyUIImageProvider", () => {
  describe("constructor", () => {
    it("uses default values when no params given", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "");
      vi.stubEnv("UPLOAD_DIR", "");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "");
      vi.stubEnv("COMFYUI_AUTH_COOKIE", "");
      const p = new ComfyUIImageProvider();
      expect((p as any).baseUrl).toBe("https://2wdf3izjfh-8188.cnb.run");
      expect((p as any).model).toBe("z-image-turbo-comfyui");
      expect((p as any).uploadDir).toBe("./uploads");
      vi.unstubAllEnvs();
    });

    it("uses env vars when params not given", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "http://localhost:8188");
      vi.stubEnv("UPLOAD_DIR", "/tmp/uploads");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "env-token");
      vi.stubEnv("COMFYUI_AUTH_COOKIE", "env-cookie");
      const p = new ComfyUIImageProvider();
      expect((p as any).baseUrl).toBe("http://localhost:8188");
      expect((p as any).uploadDir).toBe("/tmp/uploads");
      expect((p as any).authToken).toBe("env-token");
      expect((p as any).authCookie).toBe("env-cookie");
      vi.unstubAllEnvs();
    });

    it("uses constructor params over env vars", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "http://env:8188");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "env-token");
      const p = new ComfyUIImageProvider({
        baseUrl: "http://param:8188",
        authToken: "param-token",
      });
      expect((p as any).baseUrl).toBe("http://param:8188");
      expect((p as any).authToken).toBe("param-token");
      vi.unstubAllEnvs();
    });

    it("strips trailing slash from baseUrl", () => {
      const p = new ComfyUIImageProvider({ baseUrl: "http://example.com:8188/" });
      expect((p as any).baseUrl).toBe("http://example.com:8188");
    });
  });

  describe("getAuthHeaders", () => {
    it("returns empty object when no auth configured", () => {
      const p = new ComfyUIImageProvider();
      expect((p as any).getAuthHeaders()).toEqual({});
    });

    it("includes Bearer token when authToken is set", () => {
      const p = new ComfyUIImageProvider({ authToken: "abc123" });
      expect((p as any).getAuthHeaders()).toEqual({ Authorization: "Bearer abc123" });
    });

    it("includes Cookie when authCookie is set", () => {
      const p = new ComfyUIImageProvider({ authCookie: "session=xyz" });
      expect((p as any).getAuthHeaders()).toEqual({ Cookie: "session=xyz" });
    });

    it("includes both token and cookie", () => {
      const p = new ComfyUIImageProvider({ authToken: "abc", authCookie: "xyz" });
      expect((p as any).getAuthHeaders()).toEqual({
        Authorization: "Bearer abc",
        Cookie: "xyz",
      });
    });
  });

  describe("generateText", () => {
    it("throws because image provider does not support text", async () => {
      const p = new ComfyUIImageProvider();
      await expect(p.generateText("hello")).rejects.toThrow(
        "ComfyUI image provider does not support text generation",
      );
    });
  });

  describe("buildReferenceBoardPrompt", () => {
    it("returns prompt unchanged when labels is empty", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt("hello", [], []);
      expect(result).toBe("hello");
    });

    it("builds reference board when labels provided", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt(
        "Generate a comic panel",
        ["character A", "background"],
        ["person", "scene"],
      );
      expect(result).toContain("Generate a comic panel");
      expect(result).toContain("Reference 1 (person): character A");
      expect(result).toContain("Reference 2 (scene): background");
      expect(result).toContain("Preserve identity, costume, pose intent");
    });

    it("uses 'reference' as default role when roles not provided", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt(
        "Generate",
        ["item"],
        [],
      );
      expect(result).toContain("Reference 1 (reference): item");
    });
  });

  describe("buildWorkflow", () => {
    it("returns correct structure for default workflow", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildWorkflow("a cat", { aspectRatio: "16:9" });
      expect(wf["57:27"].inputs.text).toBe("a cat");
      expect(wf["57:13"].inputs.width).toBe(1536);
      expect(wf["57:13"].inputs.height).toBe(1024);
      expect(wf["9"].class_type).toBe("SaveImage");
      expect(wf["57:3"].class_type).toBe("KSampler");
      expect(wf["57:3"].inputs.steps).toBe(8);
    });

    it("uses 9:16 dimensions when specified", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildWorkflow("a cat", { aspectRatio: "9:16" });
      expect(wf["57:13"].inputs.width).toBe(1024);
      expect(wf["57:13"].inputs.height).toBe(1536);
    });

    it("generates seed for KSampler", () => {
      const p = new ComfyUIImageProvider();
      const wf1 = (p as any).buildWorkflow("a cat");
      const wf2 = (p as any).buildWorkflow("a cat");
      expect(wf1["57:3"].inputs.seed).not.toBe(wf2["57:3"].inputs.seed);
    });
  });

  describe("buildQwenEditWorkflow", () => {
    it("returns correct structure for qwen-edit workflow", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const refs = [{ name: "ref1.png" }, { name: "ref2.png" }];
      const wf = (p as any).buildQwenEditWorkflow(
        "edit this panel",
        { aspectRatio: "4:3", referenceLabels: ["person", "bg"], referenceRoles: ["person", "scene"] },
        base,
        refs,
      );
      expect(wf["49"].class_type).toBe("LoadImage");
      expect(wf["49"].inputs.image).toBe("base.png");
      expect(wf["102"].class_type).toBe("SaveImage");
      expect(wf["247"].class_type).toBe("GetImageSize");
      expect(wf["248"].inputs["自定义宽"]).toBe(1024);
      expect(wf["248"].inputs["自定义高"]).toBe(768);
      expect(wf["221"].class_type).toBe("CheckpointLoaderSimple");
      expect(wf["222"].class_type).toBe("LoraLoaderModelOnly");
    });

    it("uses base image name as secondary when no extra references", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const wf = (p as any).buildQwenEditWorkflow("edit", {}, base, []);
      expect(wf["246"].inputs.image).toBe("base.png");
    });

    it("uses first reference as secondary when available", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const refs = [{ name: "ref1.png" }];
      const wf = (p as any).buildQwenEditWorkflow("edit", {}, base, refs);
      expect(wf["246"].inputs.image).toBe("ref1.png");
    });
  });

  describe("generateImage", () => {
    it("throws when server is unreachable", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: false,
        serverReachable: false,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: { code: "SERVER_UNAVAILABLE", message: "Connection refused" },
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        "ComfyUI server unreachable: Connection refused",
      );
    });

    it("throws when qwen-edit model has no base image", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "qwen-edit-comfyui",
      });
      await expect(p.generateImage("edit", {})).rejects.toThrow(
        "ComfyUI qwen-edit requires an editBaseImage or at least one reference image",
      );
    });

    it("submits workflow and polls for result (non-qwen)", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "prompt-123" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "prompt-123": {
            outputs: {
              "9": { images: [{ filename: "output.png", subfolder: "", type: "output" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      const result = await p.generateImage("a cat");

      expect(result).toContain("mock-id-123");
      expect(result).toContain(".png");

      const submitCall = mockFetch.mock.calls[0];
      expect(submitCall[0]).toBe("http://localhost:8188/prompt");
      expect(JSON.parse(submitCall[1].body).prompt["57:27"].inputs.text).toBe("a cat");

      const historyCall = mockFetch.mock.calls[1];
      expect(historyCall[0]).toBe("http://localhost:8188/history/prompt-123");
    });

    it("throws when prompt submit fails", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal error"),
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        "ComfyUI image prompt submit failed: 500 Internal error",
      );
    });

    it("throws when prompt_id is missing in response", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ error: "no prompt_id" }),
        text: vi.fn(),
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        /no prompt_id/,
      );
    });

    it("polls until image output is found", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "prompt-456" }),
        text: vi.fn(),
      };
      const historyEmptyResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      const historyReadyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "prompt-456": {
            outputs: {
              "9": { images: [{ filename: "final.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(20)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyEmptyResponse)
        .mockResolvedValueOnce(historyReadyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      const result = await p.generateImage("a cat");
      expect(result).toContain(".jpg");
    });

    it("passes auth headers with requests", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "p-1" }),
        text: vi.fn(),
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          "p-1": { outputs: { "9": { images: [{ filename: "out.png" }] } } },
        }),
      });
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      });

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        authToken: "secret",
      });
      await p.generateImage("a cat").catch(() => {});
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
    });
  });
});
