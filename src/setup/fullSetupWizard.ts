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
  const steps = [...requiredSteps];
  if (await deps.confirmOptionalStep("scheduler")) {
    steps.push("scheduler");
  }

  let stepIndex = 0;
  while (stepIndex < steps.length) {
    const step = steps[stepIndex]!;
    const outcome = await deps.runStep(step);
    if (outcome === "quit") {
      return "quit";
    }
    if (outcome === "back") {
      if (stepIndex === 0) {
        return "done";
      }
      stepIndex -= 1;
      continue;
    }
    stepIndex += 1;
  }

  await deps.pause("Full setup finished. You can reopen any section from Setup & Connections.");
  if (await deps.confirmOptionalStep("session")) {
    await deps.enterSession();
  }
  return "done";
}
