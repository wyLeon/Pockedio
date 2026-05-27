import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pockedioVersion = readPackageVersion();

function readPackageVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "..", "package.json"),
    path.join(moduleDir, "..", "..", "package.json")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  return "0.0.0";
}
