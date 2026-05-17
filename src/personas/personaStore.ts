import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import {
  defaultPersonaConfig,
  weekdayOrder,
  type DjPersona,
  type DjPersonaConfig,
  type Weekday
} from "./defaultPersonas.js";

export type ScheduledPersona = {
  id: string;
  persona: DjPersona;
};

export function ensurePersonaFile(config: PockedioConfig): void {
  if (fs.existsSync(config.paths.personas)) {
    return;
  }

  fs.mkdirSync(path.dirname(config.paths.personas), { recursive: true });
  fs.writeFileSync(config.paths.personas, `${JSON.stringify(defaultPersonaConfig, null, 2)}\n`);
}

export function loadPersonaConfig(config: PockedioConfig): DjPersonaConfig {
  ensurePersonaFile(config);
  return validatePersonaConfig(JSON.parse(fs.readFileSync(config.paths.personas, "utf8")));
}

export function getPersonaForDate(config: PockedioConfig, date: Date): ScheduledPersona | null {
  const day = weekdayForDate(date);
  if (day === null) {
    return null;
  }

  const personaConfig = loadPersonaConfig(config);
  const id = personaConfig.weeklySchedule[day];
  return { id, persona: personaConfig.personas[id] };
}

export function validatePersonaConfig(value: unknown): DjPersonaConfig {
  if (!isRecord(value)) {
    throw new Error("Persona config must be an object.");
  }
  if (value.defaultLanguage !== "en") {
    throw new Error("Persona config defaultLanguage must be en.");
  }
  if (!isRecord(value.weeklySchedule)) {
    throw new Error("Persona config weeklySchedule must be an object.");
  }
  if (!isRecord(value.personas)) {
    throw new Error("Persona config personas must be an object.");
  }

  for (const day of weekdayOrder) {
    const personaId = value.weeklySchedule[day];
    if (typeof personaId !== "string" || personaId.length === 0) {
      throw new Error(`Persona config weeklySchedule.${day} must name a persona.`);
    }
    if (!isRecord(value.personas[personaId])) {
      throw new Error(`Persona config references missing persona: ${personaId}.`);
    }
  }

  for (const [id, persona] of Object.entries(value.personas)) {
    if (!isRecord(persona)) {
      throw new Error(`Persona ${id} must be an object.`);
    }
    if (typeof persona.name !== "string" || persona.name.length === 0) {
      throw new Error(`Persona ${id} must define name.`);
    }
    if (persona.language !== "en") {
      throw new Error(`Persona ${id} language must be en for v1.`);
    }
    for (const field of ["tone", "musicBias", "contextStyle"]) {
      if (typeof persona[field] !== "string" || persona[field].length === 0) {
        throw new Error(`Persona ${id} must define ${field}.`);
      }
    }
  }

  return value as DjPersonaConfig;
}

function weekdayForDate(date: Date): Weekday | null {
  const day = date.getDay();
  if (day === 0 || day === 6) {
    return null;
  }
  return weekdayOrder[day - 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
