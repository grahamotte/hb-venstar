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
import ssdp from "node-ssdp";
import { URL as url } from "node:url";
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
    let devices: { [key: string]: { ip: string; name: string; uuid: string } } =
      {};

    const ssdpClient = new ssdp.Client();
    ssdpClient.removeAllListeners("response");
    ssdpClient.on("response", async (msg) => {
      const urlParts = new url(msg.LOCATION || "");
      const deviceIP = urlParts.hostname;
      try {
        this.log.debug(`checking ${deviceIP}...`);
        const res = await axios.get(`http://${deviceIP}/query/info`, {
          timeout: 500,
        });
        if (Object.keys(res.data).includes("spacetemp")) {
          this.log.info(`found thermostat ${res.data.name} at ${deviceIP}`);
          devices[deviceIP] = {
            ip: deviceIP,
            name: res.data.name,
            uuid: this.api.hap.uuid.generate(deviceIP),
          };
        }
      } catch (e) {}
    });

    const discoveryTimeout = 2000;
    await new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        ssdpClient.stop();
        resolve();
      }, discoveryTimeout);

      try {
        ssdpClient.search("venstar:thermostat:ecp");
      } catch (err) {
        clearTimeout(timeoutHandle);
        ssdpClient.stop();
        reject(err);
      }
    });

    for (const accessory of this.accessories.values()) {
      this.log.info(`remove thermostat ${accessory.displayName}...`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }

    for (const device of Object.values(devices)) {
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
