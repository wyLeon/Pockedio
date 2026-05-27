import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSourceUpdateSteps,
  detectSourceInstall,
  runSourceUpdate,
  type ProcessRunner
} from "../src/update/sourceUpdate.js";

function makeGitRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-source-update-test-")));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/wyLeon/Pockedio.git"], { cwd: root });
  return root;
}

describe("source update", () => {
  it("detects a clean source install", () => {
    const root = makeGitRepo();
    const status = detectSourceInstall(root);

    expect(status).toMatchObject({
      kind: "source",
      root,
      clean: true
    });
  });

  it("refuses dirty source installs before running update steps", async () => {
    const root = makeGitRepo();
    fs.writeFileSync(path.join(root, "local.txt"), "local change\n");

    const result = await runSourceUpdate({
      root,
      runner: async () => {
        throw new Error("runner should not be called");
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Local changes detected");
  });

  it("runs source update steps in order", async () => {
    const root = makeGitRepo();
    const observed: string[] = [];
    const runner: ProcessRunner = async (command, args) => {
      observed.push([command, ...args].join(" "));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await runSourceUpdate({ root, runner });

    expect(result.ok).toBe(true);
    expect(observed).toEqual(buildSourceUpdateSteps().map((step) => [step.command, ...step.args].join(" ")));
  });
});
