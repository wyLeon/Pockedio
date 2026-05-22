import { describe, expect, it } from "vitest";
import { runFullSetupWizard, type FullSetupStepId } from "../src/setup/fullSetupWizard.js";

describe("runFullSetupWizard", () => {
  it("runs setup steps one through five in order and treats scheduler as optional", async () => {
    const visited: FullSetupStepId[] = [];
    const prompts: string[] = [];
    const events: string[] = [];

    await runFullSetupWizard({
      runStep: async (step) => {
        visited.push(step);
        events.push(`step:${step}`);
        return "done";
      },
      confirmOptionalStep: async (step) => {
        prompts.push(step);
        events.push(`prompt:${step}`);
        return false;
      },
      pause: async () => undefined,
      enterSession: async () => undefined
    });

    expect(visited).toEqual(["llm", "voice", "netease", "playlist", "context"]);
    expect(prompts).toEqual(["scheduler", "session"]);
    expect(events.slice(0, 6)).toEqual([
      "step:llm",
      "step:voice",
      "step:netease",
      "step:playlist",
      "step:context",
      "prompt:scheduler"
    ]);
  });

  it("continues to voice after the LLM step completes instead of ending full setup", async () => {
    const visited: FullSetupStepId[] = [];

    await runFullSetupWizard({
      runStep: async (step) => {
        visited.push(step);
        return "done";
      },
      confirmOptionalStep: async () => false,
      pause: async () => undefined,
      enterSession: async () => undefined
    });

    expect(visited.slice(0, 2)).toEqual(["llm", "voice"]);
  });

  it("enters the DJ session when the final try-it prompt is accepted", async () => {
    const visited: FullSetupStepId[] = [];
    let sessionStarted = false;

    await runFullSetupWizard({
      runStep: async (step) => {
        visited.push(step);
        return "done";
      },
      confirmOptionalStep: async (step) => step === "session",
      pause: async () => undefined,
      enterSession: async () => {
        sessionStarted = true;
      }
    });

    expect(visited).toEqual(["llm", "voice", "netease", "playlist", "context"]);
    expect(sessionStarted).toBe(true);
  });

  it("does not advance to the next step when the current step returns back", async () => {
    const visited: FullSetupStepId[] = [];
    const outcomes: Partial<Record<FullSetupStepId, Array<"done" | "back">>> = {
      llm: ["done"],
      voice: ["back", "done"],
      netease: ["done"],
      playlist: ["done"],
      context: ["done"]
    };

    await runFullSetupWizard({
      runStep: async (step) => {
        visited.push(step);
        return outcomes[step]?.shift() ?? "done";
      },
      confirmOptionalStep: async () => false,
      pause: async () => undefined,
      enterSession: async () => undefined
    });

    expect(visited.slice(0, 3)).toEqual(["llm", "voice", "llm"]);
  });
});
