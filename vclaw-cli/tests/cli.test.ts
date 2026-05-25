/**
 * Unit tests for src/cli.ts
 */

import { describe, test, expect } from "bun:test";
import { parseCommand, type CLIOptions } from "../src/cli";
import type { VideoRequest } from "../src/backends/types";
import type { UseApiVideoParams } from "../src/backends/types";
import { validateFlowVideoRequest, mapModelToUseApi, mapAspectRatioToUseApi } from "../src/backends/useapi/client";

/**
 * Mirrors the propagation block in UseApiBackend.generateVideo (src/backends/useapi/index.ts)
 * for `voice`/`refVideo`/`duration`. Pure helper — no I/O — so we can assert that CLI
 * options end up on the wire params and the Task 5 validator sees them.
 */
function buildUseApiParamsFromRequest(request: VideoRequest): UseApiVideoParams {
  const params: UseApiVideoParams = {
    prompt: request.prompt,
    model: mapModelToUseApi(request.model),
    aspectRatio: mapAspectRatioToUseApi(request.aspectRatio as unknown as string),
  };
  if (request.duration !== undefined) params.duration = request.duration;
  if (request.voice) params.referenceAudio_1 = request.voice;
  if (request.refVideo) params.referenceVideo_1 = request.refVideo;
  if (request.seed !== undefined) params.seed = request.seed;
  return params;
}

describe("parseCommand", () => {
  describe("default behavior", () => {
    test("returns generate command with no arguments", () => {
      const result = parseCommand([]);
      expect(result.command).toBe("generate");
    });

    test("returns default limit of 20", () => {
      const result = parseCommand([]);
      expect(result.limit).toBe(20);
    });

    test("treats unknown first argument as generate", () => {
      const result = parseCommand(["unknown-command"]);
      expect(result.command).toBe("generate");
    });
  });

  describe("subcommands", () => {
    test("parses status command", () => {
      const result = parseCommand(["status"]);
      expect(result.command).toBe("status");
    });

    test("parses status command with batch ID", () => {
      const result = parseCommand(["status", "42"]);
      expect(result.command).toBe("status");
      expect(result.batchId).toBe(42);
    });

    test("parses list command", () => {
      const result = parseCommand(["list"]);
      expect(result.command).toBe("list");
    });

    test("parses resume command", () => {
      const result = parseCommand(["resume"]);
      expect(result.command).toBe("resume");
    });

    test("parses resume command with batch ID", () => {
      const result = parseCommand(["resume", "15"]);
      expect(result.command).toBe("resume");
      expect(result.batchId).toBe(15);
    });

    test("parses reset command", () => {
      const result = parseCommand(["reset"]);
      expect(result.command).toBe("reset");
    });

    test("parses reset command with batch ID", () => {
      const result = parseCommand(["reset", "7"]);
      expect(result.command).toBe("reset");
      expect(result.batchId).toBe(7);
    });

    test("parses history command", () => {
      const result = parseCommand(["history"]);
      expect(result.command).toBe("history");
    });

    test("parses cancel command", () => {
      const result = parseCommand(["cancel"]);
      expect(result.command).toBe("cancel");
    });

    test("parses cancel command with batch ID", () => {
      const result = parseCommand(["cancel", "99"]);
      expect(result.command).toBe("cancel");
      expect(result.batchId).toBe(99);
    });

    test("parses help command", () => {
      const result = parseCommand(["help"]);
      expect(result.command).toBe("help");
    });
  });

  describe("boolean flags", () => {
    test("parses --headless flag", () => {
      const result = parseCommand(["--headless"]);
      expect(result.headless).toBe(true);
    });

    test("parses --visible flag", () => {
      const result = parseCommand(["--visible"]);
      expect(result.visible).toBe(true);
    });

    test("parses --dry-run flag", () => {
      const result = parseCommand(["--dry-run"]);
      expect(result.dryRun).toBe(true);
    });

    test("parses --quiet flag", () => {
      const result = parseCommand(["--quiet"]);
      expect(result.quiet).toBe(true);
    });

    test("parses -q flag (short for quiet)", () => {
      const result = parseCommand(["-q"]);
      expect(result.quiet).toBe(true);
    });

    test("parses --no-audio flag", () => {
      const result = parseCommand(["--no-audio"]);
      expect(result.noAudio).toBe(true);
    });
  });

  describe("path flags", () => {
    test("parses --config flag", () => {
      const result = parseCommand(["--config", "./my-config.json"]);
      expect(result.configPath).toBe("./my-config.json");
    });

    test("parses --prompts flag", () => {
      const result = parseCommand(["--prompts", "./other.txt"]);
      expect(result.promptsPath).toBe("./other.txt");
    });

    test("parses --cookies flag", () => {
      const result = parseCommand(["--cookies", "./creds.json"]);
      expect(result.cookiesPath).toBe("./creds.json");
    });

    test("parses --output flag", () => {
      const result = parseCommand(["--output", "./videos"]);
      expect(result.outputPath).toBe("./videos");
    });
  });

  describe("video generation flags", () => {
    test("parses --prompt flag", () => {
      const result = parseCommand(["--prompt", "[sunset] Golden sunset"]);
      expect(result.inlinePrompt).toBe("[sunset] Golden sunset");
    });

    test("parses -p flag (short for prompt)", () => {
      const result = parseCommand(["-p", "[test] Test prompt"]);
      expect(result.inlinePrompt).toBe("[test] Test prompt");
    });

    test("parses --ratio flag", () => {
      const result = parseCommand(["--ratio", "landscape"]);
      expect(result.aspectRatio).toBe("landscape");
    });

    test("parses -r flag (short for ratio)", () => {
      const result = parseCommand(["-r", "portrait"]);
      expect(result.aspectRatio).toBe("portrait");
    });

    test("parses --model flag", () => {
      const result = parseCommand(["--model", "fast"]);
      expect(result.model).toBe("fast");
    });

    test("parses -m flag (short for model)", () => {
      const result = parseCommand(["-m", "quality"]);
      expect(result.model).toBe("quality");
    });

    test("parses --seed flag", () => {
      const result = parseCommand(["--seed", "12345"]);
      expect(result.seed).toBe(12345);
    });

    test("parses -s flag (short for seed)", () => {
      const result = parseCommand(["-s", "99"]);
      expect(result.seed).toBe(99);
    });

    test("parses --count flag", () => {
      const result = parseCommand(["--count", "3"]);
      expect(result.count).toBe(3);
    });

    test("parses -n flag (short for count)", () => {
      const result = parseCommand(["-n", "2"]);
      expect(result.count).toBe(2);
    });

    test("parses --tag flag", () => {
      const result = parseCommand(["--tag", "sunset"]);
      expect(result.tag).toBe("sunset");
    });

    test("parses -t flag (short for tag)", () => {
      const result = parseCommand(["-t", "ocean"]);
      expect(result.tag).toBe("ocean");
    });

    test("parses --limit flag", () => {
      const result = parseCommand(["--limit", "50"]);
      expect(result.limit).toBe(50);
    });

    test("parses --limit flag with invalid number defaults to 20", () => {
      const result = parseCommand(["--limit", "invalid"]);
      expect(result.limit).toBe(20);
    });
  });

  describe("combined flags", () => {
    test("parses multiple boolean flags", () => {
      const result = parseCommand(["--visible", "--dry-run", "--quiet"]);
      expect(result.visible).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.quiet).toBe(true);
    });

    test("parses subcommand with flags", () => {
      const result = parseCommand(["status", "--limit", "10"]);
      expect(result.command).toBe("status");
      expect(result.limit).toBe(10);
    });

    test("parses full video generation command", () => {
      const result = parseCommand([
        "-p", "[test] My video",
        "-r", "16:9",
        "-m", "fast",
        "-s", "123",
        "-n", "2",
        "--no-audio",
      ]);
      expect(result.command).toBe("generate");
      expect(result.inlinePrompt).toBe("[test] My video");
      expect(result.aspectRatio).toBe("16:9");
      expect(result.model).toBe("fast");
      expect(result.seed).toBe(123);
      expect(result.count).toBe(2);
      expect(result.noAudio).toBe(true);
    });

    test("parses prompt with tag override", () => {
      const result = parseCommand(["-p", "Ocean waves", "-t", "waves"]);
      expect(result.inlinePrompt).toBe("Ocean waves");
      expect(result.tag).toBe("waves");
    });

    test("parses history command with limit", () => {
      const result = parseCommand(["history", "--limit", "10"]);
      expect(result.command).toBe("history");
      expect(result.limit).toBe(10);
    });

    test("parses list command with limit", () => {
      const result = parseCommand(["list", "--limit", "5"]);
      expect(result.command).toBe("list");
      expect(result.limit).toBe(5);
    });
  });

  describe("edge cases", () => {
    test("ignores flag-like second argument for status", () => {
      const result = parseCommand(["status", "--limit", "10"]);
      expect(result.command).toBe("status");
      expect(result.batchId).toBeUndefined();
      expect(result.limit).toBe(10);
    });

    test("handles batch ID before flags", () => {
      const result = parseCommand(["status", "42", "--limit", "10"]);
      expect(result.command).toBe("status");
      expect(result.batchId).toBe(42);
      expect(result.limit).toBe(10);
    });

    test("parses flags with subcommand followed by batch ID", () => {
      const result = parseCommand(["resume", "5", "--visible"]);
      expect(result.command).toBe("resume");
      expect(result.batchId).toBe(5);
      expect(result.visible).toBe(true);
    });

    test("handles empty prompt value gracefully", () => {
      // When --prompt is followed by another flag, it may capture undefined
      const result = parseCommand(["-p", "--visible"]);
      // The "-p" will consume "--visible" as its value
      expect(result.inlinePrompt).toBe("--visible");
      expect(result.visible).toBeUndefined();
    });

    test("parses long-form and short-form flags together", () => {
      const result = parseCommand([
        "--prompt", "Test prompt",
        "-r", "portrait",
        "--model", "free",
        "-q",
      ]);
      expect(result.inlinePrompt).toBe("Test prompt");
      expect(result.aspectRatio).toBe("portrait");
      expect(result.model).toBe("free");
      expect(result.quiet).toBe(true);
    });

    test("handles all path options together", () => {
      const result = parseCommand([
        "--config", "./c.json",
        "--prompts", "./p.txt",
        "--cookies", "./k.json",
        "--output", "./out",
      ]);
      expect(result.configPath).toBe("./c.json");
      expect(result.promptsPath).toBe("./p.txt");
      expect(result.cookiesPath).toBe("./k.json");
      expect(result.outputPath).toBe("./out");
    });

    test("parses seed as 0 correctly", () => {
      const result = parseCommand(["--seed", "0"]);
      expect(result.seed).toBe(0);
    });

    test("parses count as 1 correctly", () => {
      const result = parseCommand(["--count", "1"]);
      expect(result.count).toBe(1);
    });

    test("handles negative numbers for seed", () => {
      const result = parseCommand(["--seed", "-5"]);
      expect(result.seed).toBe(-5);
    });
  });

  describe("command detection priority", () => {
    test("command keyword takes precedence even with similar flags", () => {
      // "status" as first arg is treated as command, not value
      const result = parseCommand(["status"]);
      expect(result.command).toBe("status");
    });

    test("flags starting with hyphen are not treated as commands", () => {
      const result = parseCommand(["--visible"]);
      expect(result.command).toBe("generate");
      expect(result.visible).toBe(true);
    });

    test("numeric first argument is treated as generate", () => {
      const result = parseCommand(["42"]);
      expect(result.command).toBe("generate");
    });
  });

  describe("useapi.net backend options", () => {
    test("parses --backend flag with direct value", () => {
      const result = parseCommand(["--backend", "direct"]);
      expect(result.backend).toBe("direct");
    });

    test("parses --backend flag with useapi value", () => {
      const result = parseCommand(["--backend", "useapi"]);
      expect(result.backend).toBe("useapi");
    });

    test("parses --yes flag", () => {
      const result = parseCommand(["--yes"]);
      expect(result.yes).toBe(true);
    });

    test("parses -y flag (short for yes)", () => {
      const result = parseCommand(["-y"]);
      expect(result.yes).toBe(true);
    });

    test("parses --webhook flag", () => {
      const result = parseCommand(["--webhook", "https://example.com/hook"]);
      expect(result.webhookUrl).toBe("https://example.com/hook");
    });

    test("parses useapi with yes flag for scripting", () => {
      const result = parseCommand(["--backend", "useapi", "--yes", "-p", "test"]);
      expect(result.backend).toBe("useapi");
      expect(result.yes).toBe(true);
      expect(result.inlinePrompt).toBe("test");
    });

    test("parses full useapi generation command", () => {
      const result = parseCommand([
        "--backend", "useapi",
        "-p", "[test] My video",
        "-r", "landscape",
        "-m", "fast",
        "--yes",
        "--webhook", "https://myapp.com/notify",
      ]);
      expect(result.backend).toBe("useapi");
      expect(result.inlinePrompt).toBe("[test] My video");
      expect(result.aspectRatio).toBe("landscape");
      expect(result.model).toBe("fast");
      expect(result.yes).toBe(true);
      expect(result.webhookUrl).toBe("https://myapp.com/notify");
    });
  });

  describe("useapi.net subcommands", () => {
    test("parses useapi:accounts command", () => {
      const result = parseCommand(["useapi:accounts"]);
      expect(result.command).toBe("useapi:accounts");
      expect(result.useapiSubcommand).toBe("list");
    });

    test("parses useapi:accounts list subcommand", () => {
      const result = parseCommand(["useapi:accounts", "list"]);
      expect(result.command).toBe("useapi:accounts");
      expect(result.useapiSubcommand).toBe("list");
    });

    test("parses useapi:accounts add subcommand", () => {
      const result = parseCommand(["useapi:accounts", "add"]);
      expect(result.command).toBe("useapi:accounts");
      expect(result.useapiSubcommand).toBe("add");
    });

    test("parses useapi:accounts add with cookies path", () => {
      const result = parseCommand(["useapi:accounts", "add", "--cookies", "./other.json"]);
      expect(result.command).toBe("useapi:accounts");
      expect(result.useapiSubcommand).toBe("add");
      expect(result.cookiesPath).toBe("./other.json");
    });

    test("parses useapi:captcha command", () => {
      const result = parseCommand(["useapi:captcha"]);
      expect(result.command).toBe("useapi:captcha");
    });

    test("parses useapi:captcha list subcommand", () => {
      const result = parseCommand(["useapi:captcha", "list"]);
      expect(result.command).toBe("useapi:captcha");
      expect(result.useapiSubcommand).toBe("list");
    });

    test("parses useapi:captcha with provider and key", () => {
      const result = parseCommand(["useapi:captcha", "--provider", "ezcaptcha", "--key", "abc123"]);
      expect(result.command).toBe("useapi:captcha");
      expect(result.captchaProvider).toBe("ezcaptcha");
      expect(result.captchaKey).toBe("abc123");
    });

    test("parses useapi:health command", () => {
      const result = parseCommand(["useapi:health"]);
      expect(result.command).toBe("useapi:health");
    });
  });

  describe("parallel processing flags", () => {
    test("parses --concurrency flag", () => {
      const result = parseCommand(["--concurrency", "3"]);
      expect(result.concurrency).toBe(3);
    });

    test("parses -c flag (short for concurrency)", () => {
      const result = parseCommand(["-c", "5"]);
      expect(result.concurrency).toBe(5);
    });

    test("concurrency defaults to undefined when not specified", () => {
      const result = parseCommand([]);
      expect(result.concurrency).toBeUndefined();
    });

    test("concurrency is capped at minimum 1", () => {
      const result = parseCommand(["--concurrency", "0"]);
      expect(result.concurrency).toBe(1);
    });

    test("concurrency is capped at minimum 1 for negative values", () => {
      const result = parseCommand(["--concurrency", "-5"]);
      expect(result.concurrency).toBe(1);
    });

    test("concurrency is capped at maximum 10", () => {
      const result = parseCommand(["--concurrency", "100"]);
      expect(result.concurrency).toBe(10);
    });

    test("concurrency 10 is accepted", () => {
      const result = parseCommand(["--concurrency", "10"]);
      expect(result.concurrency).toBe(10);
    });

    test("concurrency handles non-numeric value", () => {
      const result = parseCommand(["--concurrency", "invalid"]);
      expect(result.concurrency).toBe(1); // NaN becomes 1
    });

    test("concurrency combined with other useapi flags", () => {
      const result = parseCommand([
        "--backend", "useapi",
        "-c", "4",
        "-p", "[test] My video",
        "--yes",
      ]);
      expect(result.backend).toBe("useapi");
      expect(result.concurrency).toBe(4);
      expect(result.inlinePrompt).toBe("[test] My video");
      expect(result.yes).toBe(true);
    });
  });

  describe("from-job flag", () => {
    test("parses --from-job flag", () => {
      const result = parseCommand(["--from-job", "5"]);
      expect(result.fromJob).toBe(5);
    });

    test("from-job accepts 1 (first job)", () => {
      const result = parseCommand(["--from-job", "1"]);
      expect(result.fromJob).toBe(1);
    });

    test("from-job accepts 0", () => {
      const result = parseCommand(["--from-job", "0"]);
      expect(result.fromJob).toBe(0);
    });

    test("from-job handles negative value", () => {
      const result = parseCommand(["--from-job", "-3"]);
      expect(result.fromJob).toBe(-3); // No capping, just parses as-is
    });

    test("from-job defaults to undefined", () => {
      const result = parseCommand([]);
      expect(result.fromJob).toBeUndefined();
    });

    test("from-job combined with resume command", () => {
      const result = parseCommand(["resume", "42", "--from-job", "10"]);
      expect(result.command).toBe("resume");
      expect(result.batchId).toBe(42);
      expect(result.fromJob).toBe(10);
    });

    test("from-job combined with concurrency", () => {
      const result = parseCommand([
        "--backend", "useapi",
        "--from-job", "3",
        "-c", "5",
      ]);
      expect(result.backend).toBe("useapi");
      expect(result.fromJob).toBe(3);
      expect(result.concurrency).toBe(5);
    });
  });

  describe("Flow v1 flags (Task 10)", () => {
    test("parses --duration flag as integer", () => {
      const result = parseCommand(["--duration", "6"]);
      expect(result.duration).toBe(6);
    });

    test("parses --duration 4 correctly", () => {
      const result = parseCommand(["--duration", "4"]);
      expect(result.duration).toBe(4);
    });

    test("parses --duration 8 correctly", () => {
      const result = parseCommand(["--duration", "8"]);
      expect(result.duration).toBe(8);
    });

    test("parses --duration 10 correctly", () => {
      const result = parseCommand(["--duration", "10"]);
      expect(result.duration).toBe(10);
    });

    test("--voice Kore parses to voice: 'Kore'", () => {
      const result = parseCommand(["--voice", "Kore"]);
      expect(result.voice).toBe("Kore");
    });

    test("--voice with another preset name", () => {
      const result = parseCommand(["--voice", "Aoede"]);
      expect(result.voice).toBe("Aoede");
    });

    test("--model omni-flash is accepted", () => {
      const result = parseCommand(["--model", "omni-flash"]);
      expect(result.model).toBe("omni-flash");
    });

    test("--model omni is accepted", () => {
      const result = parseCommand(["--model", "omni"]);
      expect(result.model).toBe("omni");
    });

    test("--model lite is accepted", () => {
      const result = parseCommand(["--model", "lite"]);
      expect(result.model).toBe("lite");
    });

    test("parses --ref-video <id> to refVideo", () => {
      const result = parseCommand(["--ref-video", "CAMaJDabc123"]);
      expect(result.refVideo).toBe("CAMaJDabc123");
    });

    test("duration defaults to undefined when not specified", () => {
      const result = parseCommand([]);
      expect(result.duration).toBeUndefined();
    });

    test("voice defaults to undefined when not specified", () => {
      const result = parseCommand([]);
      expect(result.voice).toBeUndefined();
    });

    test("refVideo defaults to undefined when not specified", () => {
      const result = parseCommand([]);
      expect(result.refVideo).toBeUndefined();
    });

    test("duration combined with model and voice", () => {
      const result = parseCommand([
        "--model", "omni-flash",
        "--duration", "10",
        "--voice", "Kore",
        "--ref-video", "CAMaJDvideo123",
      ]);
      expect(result.model).toBe("omni-flash");
      expect(result.duration).toBe(10);
      expect(result.voice).toBe("Kore");
      expect(result.refVideo).toBe("CAMaJDvideo123");
    });
  });

  describe("useapi:extend and useapi:concat subcommands (Task 10)", () => {
    test("parses useapi:extend command", () => {
      const result = parseCommand(["useapi:extend"]);
      expect(result.command).toBe("useapi:extend");
    });

    test("parses useapi:extend with --media-id and --prompt", () => {
      const result = parseCommand(["useapi:extend", "--media-id", "CAMaJDabc", "--prompt", "Ocean waves continue"]);
      expect(result.command).toBe("useapi:extend");
      expect(result.mediaId).toBe("CAMaJDabc");
      expect(result.inlinePrompt).toBe("Ocean waves continue");
    });

    test("parses useapi:concat command", () => {
      const result = parseCommand(["useapi:concat"]);
      expect(result.command).toBe("useapi:concat");
    });

    test("parses useapi:concat with --media-ids", () => {
      const result = parseCommand(["useapi:concat", "--media-ids", "id1,id2,id3"]);
      expect(result.command).toBe("useapi:concat");
      expect(result.mediaIds).toBe("id1,id2,id3");
    });

    test("useapi:extend combined with backend flag", () => {
      const result = parseCommand(["useapi:extend", "--media-id", "CAMaJDxyz", "--prompt", "Continue the scene", "--yes"]);
      expect(result.command).toBe("useapi:extend");
      expect(result.mediaId).toBe("CAMaJDxyz");
      expect(result.inlinePrompt).toBe("Continue the scene");
      expect(result.yes).toBe(true);
    });

    test("useapi:concat combined with output-file", () => {
      const result = parseCommand(["useapi:concat", "--media-ids", "id1,id2", "--output-file", "./out.mp4"]);
      expect(result.command).toBe("useapi:concat");
      expect(result.mediaIds).toBe("id1,id2");
      expect(result.outputFile).toBe("./out.mp4");
    });
  });

  describe("Flow v1 propagation: CLI options → VideoRequest → UseApiVideoParams (Task 10 fix)", () => {
    test("--voice Kore propagates through to referenceAudio_1 on the wire", () => {
      // 1. Parse CLI
      const opts = parseCommand(["--voice", "Kore"]);
      expect(opts.voice).toBe("Kore");

      // 2. Build VideoRequest the way google.ts does — spread CLI extras onto the request
      const request: VideoRequest = {
        type: "text",
        prompt: "A scene",
        aspectRatio: "landscape" as never,
        model: "veo-3.1-fast",
        voice: opts.voice,
        refVideo: opts.refVideo,
        duration: opts.duration as 4 | 6 | 8 | 10 | undefined,
      };
      expect(request.voice).toBe("Kore");

      // 3. Build wire params the way UseApiBackend.generateVideo does
      const params = buildUseApiParamsFromRequest(request);
      expect(params.referenceAudio_1).toBe("Kore");
    });

    test("--ref-video <id> propagates through to referenceVideo_1 on the wire", () => {
      const opts = parseCommand(["--ref-video", "CAMaJDvideo123", "--model", "omni-flash"]);
      expect(opts.refVideo).toBe("CAMaJDvideo123");

      const request: VideoRequest = {
        type: "text",
        prompt: "A scene",
        aspectRatio: "landscape" as never,
        model: opts.model || "veo-3.1-fast",
        voice: opts.voice,
        refVideo: opts.refVideo,
        duration: opts.duration as 4 | 6 | 8 | 10 | undefined,
      };
      expect(request.refVideo).toBe("CAMaJDvideo123");

      const params = buildUseApiParamsFromRequest(request);
      expect(params.referenceVideo_1).toBe("CAMaJDvideo123");
      expect(params.model).toBe("omni-flash");
    });

    test("Veo + --voice without referenceImage_* trips validator (R2V required) end-to-end", () => {
      // This is the most important integration test: it proves that voice actually
      // reaches the validator and the Task 5 rule fires for Veo voice without R2V.
      const opts = parseCommand(["--voice", "Kore", "--model", "fast"]);
      const request: VideoRequest = {
        type: "text",
        prompt: "A scene",
        aspectRatio: "landscape" as never,
        model: opts.model!,
        voice: opts.voice,
      };
      const params = buildUseApiParamsFromRequest(request);
      const result = validateFlowVideoRequest(params);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toContain("referenceAudio_*");
    });

    test("omni-flash + --voice without R2V or V2V is rejected (live-API parity)", () => {
      // Live API on 2026-05-24 returned: "referenceAudio_1 requires at least
      // one referenceImage_1." — omni-flash voice needs a refImg or refVideo.
      const opts = parseCommand(["--voice", "Kore", "--model", "omni-flash"]);
      const request: VideoRequest = {
        type: "text",
        prompt: "A scene",
        aspectRatio: "landscape" as never,
        model: opts.model!,
        voice: opts.voice,
      };
      const params = buildUseApiParamsFromRequest(request);
      const result = validateFlowVideoRequest(params);
      expect(result.ok).toBe(false);
      expect(params.referenceAudio_1).toBe("Kore");  // wiring still works
    });

    test("omni-flash + --voice + --ref-video (V2V) is valid", () => {
      const opts = parseCommand(["--voice", "Kore", "--ref-video", "v123", "--model", "omni-flash"]);
      const request: VideoRequest = {
        type: "text",
        prompt: "Edit with narration",
        aspectRatio: "landscape" as never,
        model: opts.model!,
        voice: opts.voice,
        refVideo: opts.refVideo,
      };
      const params = buildUseApiParamsFromRequest(request);
      const result = validateFlowVideoRequest(params);
      expect(result.ok).toBe(true);
    });

    test("omni-flash + --ref-video routes through validator with no errors", () => {
      const opts = parseCommand(["--ref-video", "CAMaJDvideoXYZ", "--model", "omni-flash"]);
      const request: VideoRequest = {
        type: "text",
        prompt: "Edit this clip",
        aspectRatio: "landscape" as never,
        model: opts.model!,
        refVideo: opts.refVideo,
      };
      const params = buildUseApiParamsFromRequest(request);
      const result = validateFlowVideoRequest(params);
      expect(result.ok).toBe(true);
      expect(params.referenceVideo_1).toBe("CAMaJDvideoXYZ");
    });

    test("Veo (fast) + --ref-video trips validator (V2V is omni-flash only)", () => {
      // Proves refVideo really reaches the validator: Veo models reject referenceVideo_1.
      const opts = parseCommand(["--ref-video", "CAMaJDvideoXYZ", "--model", "fast"]);
      const request: VideoRequest = {
        type: "text",
        prompt: "Edit this clip",
        aspectRatio: "landscape" as never,
        model: opts.model!,
        refVideo: opts.refVideo,
      };
      const params = buildUseApiParamsFromRequest(request);
      const result = validateFlowVideoRequest(params);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toContain("referenceVideo_1");
    });

    test("CLI flags absent → wire params omit referenceAudio_1 and referenceVideo_1", () => {
      // Negative case: a bare request should not invent referenceAudio_1/referenceVideo_1.
      const opts = parseCommand([]);
      const request: VideoRequest = {
        type: "text",
        prompt: "A scene",
        aspectRatio: "landscape" as never,
        model: "veo-3.1-fast",
        voice: opts.voice,
        refVideo: opts.refVideo,
      };
      const params = buildUseApiParamsFromRequest(request);
      expect(params.referenceAudio_1).toBeUndefined();
      expect(params.referenceVideo_1).toBeUndefined();
    });
  });
});
