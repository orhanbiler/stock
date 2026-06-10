import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".data");

function ensureDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // best-effort; persistence is a convenience, not a requirement
  }
}

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  try {
    ensureDir();
    writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, 2));
  } catch {
    // ignore — in-memory state remains authoritative
  }
}
