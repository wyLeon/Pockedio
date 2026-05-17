import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfigPath, getDatabasePath, getDjAudioDir, getPockedioHome } from "../src/config/paths.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "../src/config/load.js";
import { buildConfigFromAnswers } from "../src/config/setup.js";

const tempDirs: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-config-test-"));
  tempDirs.push(home);
  return { POCKEDIO_HOME: home };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("config paths", () => {
  it("uses POCKEDIO_HOME when provided", () => {
    const env = makeEnv();

    expect(getPockedioHome(env)).toBe(env.POCKEDIO_HOME);
    expect(getConfigPath(env)).toBe(path.join(env.POCKEDIO_HOME!, "config.json"));
    expect(getDatabasePath(env)).toBe(path.join(env.POCKEDIO_HOME!, "pockedio.sqlite"));
    expect(getDjAudioDir(env)).toBe(path.join(env.POCKEDIO_HOME!, "audio", "dj"));
  });
});

describe("config load and save", () => {
  it("loads defaults", () => {
    const config = loadConfig(makeEnv());

    expect(config.netease.baseUrl).toBe("http://127.0.0.1:3000");
    expect(config.weather.location).toBe("Shanghai");
    expect(config.calendar.enabled).toBe(true);
    expect(config.diary.enabled).toBe(false);
    expect(config.personality.mbti).toBeUndefined();
    expect(config.llm.model).toBe("gpt-4.1-mini");
  });

  it("saves and loads a valid MBTI type", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = buildConfigFromAnswers(current, {
      neteaseBaseUrl: current.netease.baseUrl,
      weatherLocation: current.weather.location,
      calendarEnabled: current.calendar.enabled,
      diaryEnabled: false,
      mbti: "INTJ",
      llmModel: current.llm.model,
      fishAudioPythonPath: current.fishAudio.pythonPath,
      fishAudioScriptPath: current.fishAudio.scriptPath,
      fishAudioModelDir: current.fishAudio.modelDir
    });

    ensureRuntimeDirs(config, env);
    saveConfig(config, env);

    expect(loadConfig(env).personality.mbti).toBe("INTJ");
  });

  it("rejects an invalid MBTI type", () => {
    const env = makeEnv();
    const configPath = getConfigPath(env);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ personality: { mbti: "NOPE" } }));

    expect(() => loadConfig(env)).toThrow();
  });

  it("accepts unset MBTI", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = buildConfigFromAnswers(current, {
      neteaseBaseUrl: current.netease.baseUrl,
      weatherLocation: current.weather.location,
      calendarEnabled: current.calendar.enabled,
      diaryEnabled: false,
      mbti: "Unset",
      llmModel: current.llm.model,
      fishAudioPythonPath: current.fishAudio.pythonPath,
      fishAudioScriptPath: current.fishAudio.scriptPath,
      fishAudioModelDir: current.fishAudio.modelDir
    });

    expect(config.personality.mbti).toBeUndefined();
  });
});
