export type FullSetupStepId = "llm" | "voice" | "netease" | "playlist" | "context" | "scheduler";
export type FullSetupOptionalPrompt = "scheduler" | "session";
export type FullSetupStepOutcome = "done" | "back" | "quit";
export type FullSetupWizardOutcome = "done" | "quit";

export type FullSetupWizardDependencies = {
  runStep: (step: FullSetupStepId) => Promise<FullSetupStepOutcome>;
  confirmOptionalStep: (step: FullSetupOptionalPrompt) => Promise<boolean>;
  pause: (message: string) => Promise<void>;
  enterSession: () => Promise<void>;
};

const requiredSteps: FullSetupStepId[] = ["llm", "voice", "netease", "playlist", "context"];

export async function runFullSetupWizard(deps: FullSetupWizardDependencies): Promise<FullSetupWizardOutcome> {
  for (const step of requiredSteps) {
    const outcome = await deps.runStep(step);
    if (outcome === "quit") {
      return "quit";
    }
  }

  if (await deps.confirmOptionalStep("scheduler")) {
    const outcome = await deps.runStep("scheduler");
    if (outcome === "quit") {
      return "quit";
    }
  }

  await deps.pause("Full setup finished. You can reopen any section from Setup & Connections.");
  if (await deps.confirmOptionalStep("session")) {
    await deps.enterSession();
  }
  return "done";
}
