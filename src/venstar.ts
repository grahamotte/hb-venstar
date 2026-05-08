export enum VenstarMode {
  Off = 0,
  Heat = 1,
  Cool = 2,
  Auto = 3,
}

export enum VenstarState {
  Idle = 0,
  Heating = 1,
  Cooling = 2,
}

export interface VenstarInfo {
  readonly name: string;
  readonly mode: VenstarMode;
  readonly state: VenstarState;
  readonly fan: number;
  readonly fanstate: number;
  readonly tempunits: number;
  readonly spacetemp: number;
  readonly heattemp: number;
  readonly cooltemp: number;
  readonly cooltempmin?: number;
  readonly cooltempmax?: number;
  readonly heattempmin?: number;
  readonly heattempmax?: number;
}

export interface VenstarControl {
  readonly mode: VenstarMode;
  readonly fan: number;
  readonly heattemp: number;
  readonly cooltemp: number;
}

export interface ThermostatValues {
  readonly mode: VenstarMode;
  readonly fan: number;
  readonly useFahrenheit: boolean;
  readonly currentTemperature: number;
  readonly heatTemperature: number;
  readonly coolTemperature: number;
  readonly targetTemperature: number;
  readonly temperatureDisplayUnits: number;
  readonly currentHeatingCoolingState: number;
  readonly targetHeatingCoolingState: number;
  readonly heatingThresholdTemperature: number;
  readonly coolingThresholdTemperature: number;
  readonly fanActive: number;
}

export interface ThermostatChange {
  readonly mode?: VenstarMode;
  readonly fan?: number;
  readonly targetTemperature?: number;
  readonly heatTemperature?: number;
  readonly coolTemperature?: number;
}

export class VenstarError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VenstarError";
  }
}

export class VenstarClient {
  private readonly baseUrl: URL;

  constructor(
    public readonly host: string,
    private readonly requestTimeoutMs: number,
  ) {
    this.baseUrl = new URL(`http://${host}`);
  }

  async getInfo(): Promise<VenstarInfo> {
    try {
      const data = await this.requestJson("/query/info");
      return parseVenstarInfo(data);
    } catch (error) {
      throw toVenstarError(this.host, "Failed to query thermostat info", error);
    }
  }

  async setControl(control: VenstarControl): Promise<void> {
    try {
      const data = await this.requestJson("/control", {
        method: "POST",
        params: {
          mode: control.mode,
          fan: control.fan,
          heattemp: control.heattemp,
          cooltemp: control.cooltemp,
        },
      });
      if (isRecord(data) && data.error) {
        throw new Error(String(data.reason ?? data.error));
      }
    } catch (error) {
      throw toVenstarError(this.host, "Failed to update thermostat control", error);
    }
  }

  private async requestJson(
    path: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly params?: Record<string, string | number>;
    } = {},
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseVenstarInfo(data: unknown): VenstarInfo {
  if (!isRecord(data)) {
    throw new Error("Venstar response was not an object");
  }

  return {
    name: readString(data.name, "Venstar Thermostat"),
    mode: readMode(data.mode),
    state: readState(data.state),
    fan: readNumber(data.fan, 0),
    fanstate: readNumber(data.fanstate, 0),
    tempunits: readNumber(data.tempunits, 0),
    spacetemp: readRequiredNumber(data.spacetemp, "spacetemp"),
    heattemp: readRequiredNumber(data.heattemp, "heattemp"),
    cooltemp: readRequiredNumber(data.cooltemp, "cooltemp"),
    cooltempmin: readOptionalNumber(data.cooltempmin),
    cooltempmax: readOptionalNumber(data.cooltempmax),
    heattempmin: readOptionalNumber(data.heattempmin),
    heattempmax: readOptionalNumber(data.heattempmax),
  };
}

export function mapVenstarToHomeKit(info: VenstarInfo): ThermostatValues {
  const useFahrenheit = info.tempunits === 0;
  const currentTemperature = toHomeKitTemperature(info.spacetemp, useFahrenheit);
  const heatTemperature = toHomeKitTemperature(info.heattemp, useFahrenheit);
  const coolTemperature = toHomeKitTemperature(info.cooltemp, useFahrenheit);

  return {
    mode: info.mode,
    fan: info.fan,
    useFahrenheit,
    currentTemperature,
    heatTemperature,
    coolTemperature,
    targetTemperature: targetTemperatureForMode(
      info.mode,
      currentTemperature,
      heatTemperature,
      coolTemperature,
    ),
    temperatureDisplayUnits: useFahrenheit ? 1 : 0,
    currentHeatingCoolingState: currentStateForVenstarState(info.state),
    targetHeatingCoolingState: targetStateForVenstarMode(info.mode),
    heatingThresholdTemperature: clamp(heatTemperature, 0, 25),
    coolingThresholdTemperature: clamp(coolTemperature, 10, 35),
    fanActive: info.fan === 0 ? 0 : 1,
  };
}

export function buildControlFromChange(
  current: ThermostatValues,
  change: ThermostatChange,
): VenstarControl {
  const mode = change.mode ?? current.mode;
  const fan = change.fan ?? current.fan;
  let heatTemperature = change.heatTemperature ?? current.heatTemperature;
  let coolTemperature = change.coolTemperature ?? current.coolTemperature;

  if (change.targetTemperature !== undefined) {
    if (mode === VenstarMode.Heat) {
      heatTemperature = change.targetTemperature;
    } else if (mode === VenstarMode.Cool) {
      coolTemperature = change.targetTemperature;
    } else if (mode === VenstarMode.Auto) {
      const deadband = Math.max(coolTemperature - heatTemperature, 1);
      heatTemperature = change.targetTemperature - deadband / 2;
      coolTemperature = change.targetTemperature + deadband / 2;
    }
  }

  return {
    mode,
    fan,
    heattemp: fromHomeKitTemperature(heatTemperature, current.useFahrenheit),
    cooltemp: fromHomeKitTemperature(coolTemperature, current.useFahrenheit),
  };
}

export function toHomeKitTemperature(value: number, useFahrenheit: boolean): number {
  return round2(useFahrenheit ? ((value - 32) * 5) / 9 : value);
}

export function fromHomeKitTemperature(value: number, useFahrenheit: boolean): number {
  return round2(useFahrenheit ? (value * 9) / 5 + 32 : value);
}

function targetTemperatureForMode(
  mode: VenstarMode,
  currentTemperature: number,
  heatTemperature: number,
  coolTemperature: number,
): number {
  if (mode === VenstarMode.Heat) {
    return heatTemperature;
  }

  if (mode === VenstarMode.Cool) {
    return coolTemperature;
  }

  if (mode === VenstarMode.Auto) {
    return round2((heatTemperature + coolTemperature) / 2);
  }

  return currentTemperature;
}

function currentStateForVenstarState(state: VenstarState): number {
  if (state === VenstarState.Heating) {
    return 1;
  }

  if (state === VenstarState.Cooling) {
    return 2;
  }

  return 0;
}

function targetStateForVenstarMode(mode: VenstarMode): number {
  if (mode >= VenstarMode.Off && mode <= VenstarMode.Auto) {
    return mode;
  }

  return VenstarMode.Off;
}

function toVenstarError(host: string, message: string, error: unknown): VenstarError {
  if (error instanceof VenstarError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new VenstarError(`${message}: request timed out`, host, error);
  }

  if (error instanceof Error) {
    return new VenstarError(`${message}: ${error.message}`, host, error);
  }

  return new VenstarError(message, host, error);
}

function readMode(value: unknown): VenstarMode {
  const mode = readNumber(value, VenstarMode.Off);
  return mode >= VenstarMode.Off && mode <= VenstarMode.Auto ? mode : VenstarMode.Off;
}

function readState(value: unknown): VenstarState {
  const state = readNumber(value, VenstarState.Idle);
  return state >= VenstarState.Idle && state <= VenstarState.Cooling
    ? state
    : VenstarState.Idle;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readRequiredNumber(value: unknown, field: string): number {
  const numeric = readOptionalNumber(value);
  if (numeric === undefined) {
    throw new Error(`Venstar response missing numeric ${field}`);
  }

  return numeric;
}

function readNumber(value: unknown, fallback: number): number {
  return readOptionalNumber(value) ?? fallback;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
