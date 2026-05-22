import { describe, expect, it } from "vitest";
import { runFullSetupWizard, type FullSetupStepId } from "../src/setup/fullSetupWizard.js";

describe("runFullSetupWizard", () => {
  it("runs setup steps one through five in order and treats scheduler as optional", async () => {
    const visited: FullSetupStepId[] = [];
    const prompts: string[] = [];

    await runFullSetupWizard({
      runStep: async (step) => {
        visited.push(step);
        return "done";
      },
      confirmOptionalStep: async (step) => {
        prompts.push(step);
        return false;
      },
      pause: async () => undefined,
      enterSession: async () => undefined
    });

    expect(visited).toEqual(["llm", "voice", "netease", "playlist", "context"]);
    expect(prompts).toEqual(["scheduler", "session"]);
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
});
