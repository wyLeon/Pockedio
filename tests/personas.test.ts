import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { defaultPersonaConfig } from "../src/personas/defaultPersonas.js";
import {
  ensurePersonaFile,
  getPersonaForDate,
  loadPersonaConfig,
  validatePersonaConfig
} from "../src/personas/personaStore.js";

const tempDirs: string[] = [];

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-persona-test-"));
  tempDirs.push(home);
  return loadConfig({ POCKEDIO_HOME: home });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("persona config", () => {
  it("validates the default config", () => {
    expect(validatePersonaConfig(defaultPersonaConfig)).toEqual(defaultPersonaConfig);
  });

  it("fails when a scheduled persona is missing", () => {
    const invalid = structuredClone(defaultPersonaConfig);
    invalid.weeklySchedule.monday = "missing_persona";

    expect(() => validatePersonaConfig(invalid)).toThrow("missing_persona");
  });

  it("creates and loads the persona file", () => {
    const config = makeConfig();

    ensurePersonaFile(config);

    expect(fs.existsSync(config.paths.personas)).toBe(true);
    expect(loadPersonaConfig(config).defaultLanguage).toBe("en");
  });

  it("resolves Monday through Friday schedule", () => {
    const config = makeConfig();
    ensurePersonaFile(config);

    expect(getPersonaForDate(config, new Date("2026-05-18T08:45:00+08:00"))?.id).toBe("quiet_archivist");
    expect(getPersonaForDate(config, new Date("2026-05-19T08:45:00+08:00"))?.id).toBe("late_night_jazz_host");
    expect(getPersonaForDate(config, new Date("2026-05-20T08:45:00+08:00"))?.id).toBe("philosophy_selector");
    expect(getPersonaForDate(config, new Date("2026-05-21T08:45:00+08:00"))?.id).toBe("city_radio_companion");
    expect(getPersonaForDate(config, new Date("2026-05-22T08:45:00+08:00"))?.id).toBe("weekend_warmup");
  });

  it("returns null on weekends for scheduled jobs", () => {
    const config = makeConfig();
    ensurePersonaFile(config);

    expect(getPersonaForDate(config, new Date("2026-05-23T08:45:00+08:00"))).toBeNull();
    expect(getPersonaForDate(config, new Date("2026-05-24T08:45:00+08:00"))).toBeNull();
  });
});
