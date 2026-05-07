import type { PlatformConfig } from "homebridge";

export interface GoVenstarConfig {
  readonly name: string;
  readonly hosts: readonly string[];
  readonly discover: boolean;
  readonly discoveryTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly removeStaleAccessories: boolean;
}

const DEFAULT_CONFIG: GoVenstarConfig = {
  name: "GoVenstar",
  hosts: [],
  discover: true,
  discoveryTimeoutMs: 5000,
  requestTimeoutMs: 3000,
  pollIntervalMs: 30000,
  removeStaleAccessories: false,
};

export function parseConfig(config: PlatformConfig): GoVenstarConfig {
  return {
    name: readString(config.name, DEFAULT_CONFIG.name),
    hosts: readHosts(config.hosts),
    discover: readBoolean(config.discover, DEFAULT_CONFIG.discover),
    discoveryTimeoutMs: readNumber(
      config.discoveryTimeoutMs,
      DEFAULT_CONFIG.discoveryTimeoutMs,
      1000,
      30000,
    ),
    requestTimeoutMs: readNumber(
      config.requestTimeoutMs,
      DEFAULT_CONFIG.requestTimeoutMs,
      500,
      15000,
    ),
    pollIntervalMs: readNumber(
      config.pollIntervalMs,
      DEFAULT_CONFIG.pollIntervalMs,
      0,
      300000,
    ),
    removeStaleAccessories: readBoolean(
      config.removeStaleAccessories,
      DEFAULT_CONFIG.removeStaleAccessories,
    ),
  };
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return parsed.host;
  } catch {
    return trimmed.replace(/^https?:\/\//u, "").split("/")[0] ?? "";
  }
}

function readHosts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG.hosts;
  }

  return [...new Set(value.filter(isString).map(normalizeHost).filter(Boolean))];
}

function readString(value: unknown, fallback: string): string {
  return isString(value) && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
