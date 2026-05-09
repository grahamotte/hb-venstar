import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { GoVenstarPlatform } from "./platform.js";
import { homeKitSerialNumber } from "./serial.js";
import {
  buildControlFromChange,
  mapVenstarToHomeKit,
  VenstarClient,
  VenstarError,
  VenstarMode,
  type ThermostatChange,
  type ThermostatValues,
} from "./venstar.js";

interface ThermostatDevice {
  readonly id: string;
  readonly host: string;
  readonly name: string;
  readonly serialNumber?: string;
  readonly usn?: string;
}

const CACHE_TTL_MS = 5000;
const POST_SET_REFRESH_DELAY_MS = 250;

export class Thermostat {
  private readonly service: Service;
  private readonly fanService: Service;
  private readonly client: VenstarClient;
  private values?: ThermostatValues;
  private lastRefreshMs = 0;
  private refreshPromise?: Promise<ThermostatValues>;

  constructor(
    private readonly platform: GoVenstarPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: ThermostatDevice,
  ) {
    this.client = new VenstarClient(device.host, platform.settings.requestTimeoutMs);
    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);
    this.fanService =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    this.setAccessoryInformation();
    this.bindCharacteristics();
    this.startPolling();
    this.refresh().catch((error: unknown) => this.logRefreshFailure(error));
  }

  async getTemperatureDisplayUnits(): Promise<CharacteristicValue> {
    return (await this.getValues()).temperatureDisplayUnits;
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    return (await this.getValues()).currentHeatingCoolingState;
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    return (await this.getValues()).targetHeatingCoolingState;
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return (await this.getValues()).currentTemperature;
  }

  async getCoolingThresholdTemperature(): Promise<CharacteristicValue> {
    return (await this.getValues()).coolingThresholdTemperature;
  }

  async getHeatingThresholdTemperature(): Promise<CharacteristicValue> {
    return (await this.getValues()).heatingThresholdTemperature;
  }

  async getFanActive(): Promise<CharacteristicValue> {
    return (await this.getValues()).fanActive;
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    return (await this.getValues()).targetTemperature;
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    await this.set({ targetTemperature: Number(value) });
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    await this.set({ mode: Number(value) as VenstarMode });
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    await this.set({ coolTemperature: Number(value) });
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    await this.set({ heatTemperature: Number(value) });
  }

  async setFanActive(value: CharacteristicValue): Promise<void> {
    await this.set({ fan: Number(value) });
  }

  private setAccessoryInformation(): void {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, "Venstar")
      .setCharacteristic(this.platform.Characteristic.Model, "Thermostat")
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.device.serialNumber ?? homeKitSerialNumber(this.device.id, this.device.usn),
      )
      .setCharacteristic(this.platform.Characteristic.Name, this.device.name);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    this.fanService.setCharacteristic(
      this.platform.Characteristic.Name,
      `${this.device.name} Fan`,
    );
  }

  private bindCharacteristics(): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .onSet(this.setHeatingThresholdTemperature.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));
    this.fanService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getFanActive.bind(this))
      .onSet(this.setFanActive.bind(this));
  }

  private startPolling(): void {
    if (this.platform.settings.pollIntervalMs === 0) {
      return;
    }

    const timer = setInterval(() => {
      this.refresh().catch((error: unknown) => this.logRefreshFailure(error));
    }, this.platform.settings.pollIntervalMs);

    timer.unref?.();
  }

  private async getValues(): Promise<ThermostatValues> {
    if (this.values && Date.now() - this.lastRefreshMs < CACHE_TTL_MS) {
      return this.values;
    }

    return this.refresh();
  }

  private async refresh(): Promise<ThermostatValues> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.client
      .getInfo()
      .then((info) => {
        const values = mapVenstarToHomeKit(info);
        this.values = values;
        this.lastRefreshMs = Date.now();
        this.updateCharacteristics(values);
        return values;
      })
      .catch((error: unknown) => {
        if (this.values) {
          this.logRefreshFailure(error);
          return this.values;
        }

        throw this.toHapCommunicationError(error);
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });

    return this.refreshPromise;
  }

  private async set(change: ThermostatChange): Promise<void> {
    try {
      const current = await this.getValues();
      const control = buildControlFromChange(current, change);
      this.platform.log.debug(
        `${this.device.name}: setting mode=${control.mode}; fan=${control.fan}; heat=${control.heattemp}; cool=${control.cooltemp}`,
      );

      await this.client.setControl(control);
      await delay(POST_SET_REFRESH_DELAY_MS);
      await this.refresh();
    } catch (error) {
      throw this.toHapCommunicationError(error);
    }
  }

  private updateCharacteristics(values: ThermostatValues): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .updateValue(values.currentHeatingCoolingState);
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .updateValue(values.targetHeatingCoolingState);
    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .updateValue(values.temperatureDisplayUnits);
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .updateValue(values.targetTemperature);
    this.service
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .updateValue(values.coolingThresholdTemperature);
    this.service
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .updateValue(values.heatingThresholdTemperature);
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .updateValue(values.currentTemperature);
    this.fanService
      .getCharacteristic(this.platform.Characteristic.Active)
      .updateValue(values.fanActive);
  }

  private logRefreshFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.platform.log.warn(`${this.device.name}: ${message}`);
  }

  private toHapCommunicationError(error: unknown): Error {
    this.logRefreshFailure(error);

    if (error instanceof VenstarError) {
      return new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
