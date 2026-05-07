import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";
import { normalizeHost, parseConfig, type GoVenstarConfig } from "./config.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { discoverSsdpDevices } from "./ssdp.js";
import { Thermostat } from "./thermostat.js";
import { VenstarClient } from "./venstar.js";

interface DiscoveredDevice {
  readonly id: string;
  readonly host: string;
  readonly name: string;
  readonly usn?: string;
}

interface VenstarAccessoryContext {
  device?: DiscoveredDevice & {
    readonly lastSeen: string;
  };
}

export class GoVenstarPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly settings: GoVenstarConfig;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.settings = parseConfig(config);

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`Discovery failed: ${message}`);
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info("Loading accessory from cache:", accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(): Promise<void> {
    this.log.info("Discovering Venstar thermostats...");

    const devices = new Map<string, DiscoveredDevice>();
    const discovered = await Promise.all([
      this.settings.discover ? this.discoverWithSsdp() : Promise.resolve([]),
      this.discoverManualHosts(),
    ]);

    for (const device of dedupeByHost(discovered.flat())) {
      devices.set(device.id, device);
    }

    this.syncAccessories([...devices.values()]);
    this.log.info(`Venstar discovery finished: ${devices.size} thermostat(s) available.`);
  }

  private async discoverManualHosts(): Promise<DiscoveredDevice[]> {
    const results = await Promise.allSettled(
      this.settings.hosts.map((host) => this.probeHost(host, `host:${host}`)),
    );

    return results
      .filter((result): result is PromiseFulfilledResult<DiscoveredDevice> => {
        if (result.status === "rejected") {
          this.log.warn(String(result.reason));
          return false;
        }

        return true;
      })
      .map((result) => result.value);
  }

  private async discoverWithSsdp(): Promise<DiscoveredDevice[]> {
    const devices = new Map<string, DiscoveredDevice>();
    const responses = await discoverSsdpDevices(
      "venstar:thermostat:ecp",
      this.settings.discoveryTimeoutMs,
    );
    const probes = responses.map((response) => {
      const host = hostFromSsdpLocation(response.location);
      if (!host) {
        return Promise.resolve();
      }

      const id = response.usn ? `ssdp:${response.usn}` : `host:${host}`;
      return this.probeHost(host, id, response.usn)
        .then((device) => {
          devices.set(device.id, device);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.log.debug(message);
        });
    });

    await Promise.allSettled(probes);
    return [...devices.values()];
  }

  private async probeHost(
    host: string,
    fallbackId: string,
    usn?: string,
  ): Promise<DiscoveredDevice> {
    const normalizedHost = normalizeHost(host);
    const info = await new VenstarClient(
      normalizedHost,
      this.settings.requestTimeoutMs,
    ).getInfo();

    return {
      id: fallbackId,
      host: normalizedHost,
      name: info.name,
      usn,
    };
  }

  private syncAccessories(devices: readonly DiscoveredDevice[]): void {
    const seenUuids = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.id);
      const accessory =
        this.accessories.get(uuid) ??
        this.findReusableCachedAccessory(device) ??
        new this.api.platformAccessory(device.name, uuid);
      const wasCached = this.accessories.has(accessory.UUID);

      seenUuids.add(accessory.UUID);
      updateAccessoryContext(accessory, device);
      new Thermostat(this, accessory, device);

      if (wasCached) {
        this.log.info(`Restored thermostat ${device.name} at ${device.host}.`);
      } else {
        this.log.info(`Adding thermostat ${device.name} at ${device.host}.`);
        this.accessories.set(accessory.UUID, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (seenUuids.has(uuid)) {
        continue;
      }

      if (this.settings.removeStaleAccessories) {
        this.log.info(`Removing stale thermostat ${accessory.displayName}.`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
        continue;
      }

      const context = accessory.context as VenstarAccessoryContext;
      if (context.device) {
        this.log.warn(
          `Keeping cached thermostat ${context.device.name}; it was not discovered this run.`,
        );
        new Thermostat(this, accessory, context.device);
      }
    }
  }

  private findReusableCachedAccessory(
    device: DiscoveredDevice,
  ): PlatformAccessory | undefined {
    const legacyHost = hostnameOnly(device.host);
    const legacyUuids = [
      this.api.hap.uuid.generate(legacyHost),
      this.api.hap.uuid.generate(`host:${device.host}`),
    ];

    for (const uuid of legacyUuids) {
      const accessory = this.accessories.get(uuid);
      if (accessory) {
        return accessory;
      }
    }

    return [...this.accessories.values()].find((accessory) => {
      const context = accessory.context as VenstarAccessoryContext;
      return context.device?.host === device.host || context.device?.id === device.id;
    });
  }
}

function updateAccessoryContext(
  accessory: PlatformAccessory,
  device: DiscoveredDevice,
): void {
  const context = accessory.context as VenstarAccessoryContext;
  context.device = {
    ...device,
    lastSeen: new Date().toISOString(),
  };
}

function hostFromSsdpLocation(location: string | undefined): string {
  if (!location) {
    return "";
  }

  try {
    return normalizeHost(new URL(location).host);
  } catch {
    return "";
  }
}

function dedupeByHost(devices: readonly DiscoveredDevice[]): DiscoveredDevice[] {
  const byHost = new Map<string, DiscoveredDevice>();

  for (const device of devices) {
    const existing = byHost.get(device.host);
    if (!existing || shouldPreferDevice(device, existing)) {
      byHost.set(device.host, device);
    }
  }

  return [...byHost.values()];
}

function shouldPreferDevice(
  candidate: DiscoveredDevice,
  existing: DiscoveredDevice,
): boolean {
  return candidate.id.startsWith("ssdp:") && !existing.id.startsWith("ssdp:");
}

function hostnameOnly(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
}

