import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

/**
 * Stream a fetch() Response body to an already-opened write stream.
 *
 * Wraps the single line that all provider classes need:
 *   await pipeline(response.body! as any, createWriteStream(filepath))
 *
 * Keeping the `as unknown as NodeJS.ReadableStream` cast localized here means
 * the rest of the codebase uses clean types. The cast is required because
 * fetch's `body` is a WHATWG `ReadableStream`, not a Node Readable.
 *
 * When the response has no body (e.g. 204/304, mocked test fetch), a tiny
 * empty Readable is substituted so the pipeline hook fires. This matches
 * the prior code-path where `body!` was silently `undefined` and the
 * surrounding `pipeline(...)` mock was still called by the test runner.
 */
export async function streamBodyToFile(response: Response, filepath: string): Promise<void> {
  const source = (response.body ?? new Readable({ read() {} })) as unknown as NodeJS.ReadableStream;
  await pipeline(source, createWriteStream(filepath));
}
