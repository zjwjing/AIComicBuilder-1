"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useManoPStore } from "@/stores/manop-store";
import { ManoPClient } from "@/lib/manop/manop-client";
import { MousePointer2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export function ManoPSection() {
  const { config, setConfig, resetConfig } = useManoPStore();
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  async function handleHealthCheck() {
    setStatus("checking");
    setStatusMsg("");
    try {
      const client = new ManoPClient({ baseUrl: config.baseUrl });
      const res = await client.health();
      if (res.status === "ok" && res.model_loaded) {
        setStatus("ok");
        setStatusMsg("Server is running, model loaded");
      } else if (res.status === "ok") {
        setStatus("ok");
        setStatusMsg("Server is running, model not yet loaded");
      } else {
        setStatus("error");
        setStatusMsg(`Unexpected status: ${res.status}`);
      }
    } catch (e) {
      setStatus("error");
      setStatusMsg(e instanceof Error ? e.message : "Connection failed");
    }
  }

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
          <MousePointer2 className="h-3.5 w-3.5" />
          Mano-P (本地 GUI 代理)
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetConfig}
          className="h-7 text-xs text-[--text-muted]"
        >
          Reset
        </Button>
      </div>

      <div className="space-y-4">
        {/* Server URL + Health */}
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Server URL</Label>
            <Input
              value={config.baseUrl}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="http://localhost:7861"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleHealthCheck}
            disabled={status === "checking" || !config.baseUrl}
            className="h-9 gap-1.5 text-xs"
          >
            {status === "checking" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                {status === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                {status === "error" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                Check
              </>
            )}
          </Button>
        </div>

        {/* Status message */}
        {statusMsg && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              status === "ok"
                ? "border-green-200 bg-green-50 text-green-700"
                : status === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : ""
            }`}
          >
            {statusMsg}
          </div>
        )}

        {/* Generation params */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Temperature</Label>
            <Input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={config.temperature}
              onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) || 0.7 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max Tokens</Label>
            <Input
              type="number"
              min={1}
              max={2048}
              step={1}
              value={config.maxTokens}
              onChange={(e) => setConfig({ maxTokens: parseInt(e.target.value) || 256 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Top P</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.topP}
              onChange={(e) => setConfig({ topP: parseFloat(e.target.value) || 0.8 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Top K</Label>
            <Input
              type="number"
              min={1}
              max={100}
              step={1}
              value={config.topK}
              onChange={(e) => setConfig({ topK: parseInt(e.target.value) || 20 })}
            />
          </div>
        </div>

        <details className="rounded-lg border border-[--border-subtle] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[--text-muted] hover:text-[--text-primary]">
            API Reference
          </summary>
          <div className="mt-3 space-y-2 text-xs text-[--text-muted]">
            <p><code className="rounded bg-[--surface] px-1.5 py-0.5 font-mono text-[11px]">POST /api/manop/infer</code> — Send screenshot + task, get GUI actions</p>
            <pre className="overflow-x-auto rounded bg-[--surface] p-2 font-mono text-[11px]">{JSON.stringify({
              image: "<base64>",
              task: "Describe the UI and suggest actions"
            }, null, 2)}</pre>
            <p><code className="rounded bg-[--surface] px-1.5 py-0.5 font-mono text-[11px]">GET /api/manop/health</code> — Server health check</p>
          </div>
        </details>
      </div>
    </div>
  );
}
