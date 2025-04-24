import axios from "axios";
import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";
import find from "local-devices";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { Thermostat } from "./thermostat.js";

export class GoVenstarPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  public readonly CustomServices: any;
  public readonly CustomCharacteristics: any;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info("Loading accessory from cache:", accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    this.log.info("discovering devices...");
    let devices: { ip: string; name: string; uuid: string }[] = [];

    this.log.info(`scanning for thermostats...`);
    for await (const device of await find()) {
      try {
        this.log.debug(`checking ${device.ip}...`);
        const res = await axios.get(`http://${device.ip}/query/info`, {
          timeout: 500,
        });
        this.log.debug(res.data);
        if (Object.keys(res.data).includes("spacetemp")) {
          this.log.info(`found thermostat ${res.data.name} at ${device.ip}`);
          devices.push({
            ip: device.ip,
            name: res.data.name,
            uuid: this.api.hap.uuid.generate(device.ip),
          });
        }
      } catch (e) {}
    }

    for (const accessory of this.accessories.values()) {
      this.log.info(`remove thermostat ${accessory.displayName}...`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }

    for (const device of devices) {
      this.log.info(`adding thermostat ${device.name}...`);
      const accessory = new this.api.platformAccessory(
        device.name,
        device.uuid
      );
      new Thermostat(this, accessory, device.ip, device.name);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }
  }
}
