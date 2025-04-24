import type { CharacteristicValue, PlatformAccessory } from "homebridge";

import axios from "axios";
import type { GoVenstarPlatform } from "./platform.js";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Thermostat {
  private platform;
  private accessory;
  private ip;
  private name;
  private service;
  private fanService;

  constructor(
    platform: GoVenstarPlatform,
    accessory: PlatformAccessory,
    ip: string,
    name: string
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.ip = ip;
    this.name = name;

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.fanService =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    // characteristic bindings
    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this));
    this.service
      .getCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState
      )
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
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature
      )
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));
    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature
      )
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

  async get(overrides: Record<string, number> = {}) {
    const ftoc = (value: number) =>
      Math.round((((value - 32) * 5.0) / 9.0) * 100) / 100;
    const ctof = (value: number) =>
      Math.round(((value * 9.0) / 5.0 + 32) * 100) / 100;
    const temp = (useF: boolean, temp: number) => (useF ? ftoc(temp) : temp);
    const capRange = (value: number, min: number, max: number) => {
      if (value <= min) return min;
      if (value >= max) return max;
      return value;
    };

    return axios({
      method: "get",
      url: `http://${this.ip}/query/info`,
    }).then((res) => {
      const data = res.data as {
        name: string;
        mode: number;
        state: number;
        fan: number;
        fanstate: number;
        tempunits: number;
        schedule: number;
        schedulepart: number;
        away: number;
        spacetemp: number;
        heattemp: number;
        cooltemp: number;
        cooltempmin: number;
        cooltempmax: number;
        heattempmin: number;
        heattempmax: number;
        activestage: number;
        setpointdelta: number;
        availablemodes: number;
      };
      const mode =
        overrides["mode"] === undefined ? data.mode : overrides["mode"]; // 0 == off, 1 == heat, 2 == cool, 3 == auto
      const useF = data.tempunits === 0 ? true : false; // 0 == F, 1 == C ! opposite of homebridge !
      const currTemp = temp(useF, data["spacetemp"]);
      const coolTemp = temp(useF, overrides["coolTemp"] || data["cooltemp"]);
      const heatTemp = temp(useF, overrides["heatTemp"] || data["heattemp"]);
      let targetTemp = currTemp;
      if (mode === 0) {
        targetTemp = currTemp;
      } else if (mode === 1) {
        targetTemp = heatTemp;
      } else if (mode === 2) {
        targetTemp = coolTemp;
      } else if (mode === 3) {
        targetTemp = Math.round(coolTemp + (heatTemp - coolTemp) / 2);
      }

      const values = {
        mode: mode,
        useF: useF,
        currTemp: currTemp,
        currTempF: ctof(currTemp),
        heatTemp: heatTemp,
        heatTempF: ctof(heatTemp),
        coolTemp: coolTemp,
        coolTempF: ctof(coolTemp),
        targetTemp: targetTemp,
        targetTempF: ctof(targetTemp),
        fan: data.fan,
        tempUnits: useF ? 1 : 0, // 1 == F, 0 == C ! opposite of venstar !
        coolThresh: capRange(coolTemp, 10, 35),
        heatThresh: capRange(heatTemp, 0, 25),
      };

      this.platform.log.debug(
        "get:",
        Object.keys(values)
          .map((k) => `${k}: ${(values as any)[k]}`)
          .join("; ")
      );

      this.service
        .getCharacteristic(
          this.platform.Characteristic.CurrentHeatingCoolingState
        )
        .updateValue(values.mode);
      this.service
        .getCharacteristic(
          this.platform.Characteristic.TargetHeatingCoolingState
        )
        .updateValue(values.mode);
      this.service
        .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
        .updateValue(values.tempUnits);
      this.service
        .getCharacteristic(this.platform.Characteristic.TargetTemperature)
        .updateValue(values.targetTemp);
      this.service
        .getCharacteristic(
          this.platform.Characteristic.CoolingThresholdTemperature
        )
        .updateValue(values.coolThresh);
      this.service
        .getCharacteristic(
          this.platform.Characteristic.HeatingThresholdTemperature
        )
        .updateValue(values.heatThresh);
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(values.currTemp);
      this.fanService
        .getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(values.fan);

      return values;
    });
  }

  async set(change: Record<string, number>) {
    const ctof = (value: number) =>
      Math.round(((value * 9.0) / 5.0 + 32) * 100) / 100;
    const temp = (useF: boolean, temp: number) => (useF ? ctof(temp) : temp);
    const g = await this.get();
    const mode = change.mode === undefined ? g.mode : change.mode;
    const fan = change.fan === undefined ? g.fan : change.fan;

    if (change.targetTemp) {
      if (g.mode === 1) {
        change["heatTemp"] = change.targetTemp;
      } else if (g.mode === 2) {
        change["coolTemp"] = change.targetTemp;
      } else {
        change["coolTemp"] = change.targetTemp;
        change["heatTemp"] = change.targetTemp;
      }
    }

    const heatTemp = temp(g.useF, change.heatTemp || g.heatTemp);
    const coolTemp = temp(g.useF, change.coolTemp || g.coolTemp);
    const values = {
      mode: mode,
      fan: fan,
      heatTemp: heatTemp,
      coolTemp: coolTemp,
    };

    this.platform.log.debug(
      `set:`,
      Object.keys(values)
        .map((k) => `${k}: ${(values as any)[k]}`)
        .join("; ")
    );

    const res = await axios({
      method: "post",
      url: `http://${this.ip}/control?${[
        `mode=${values.mode}`,
        `fan=${values.fan}`,
        `heattemp=${values.heatTemp}`,
        `cooltemp=${values.coolTemp}`,
      ].join("&")}`,
    });

    if (res.data.error) {
      this.platform.log.error(res.data);
    } else {
      await setTimeout(() => this.get(values), 100);
    }
  }

  // getters

  async getTemperatureDisplayUnits() {
    return await this.get().then((x) => x.tempUnits);
  }

  async getCurrentHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async getTargetHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async getCurrentTemperature() {
    return await this.get().then((x) => x.currTemp);
  }

  async getCoolingThresholdTemperature() {
    return await this.get().then((x) => x.coolThresh);
  }

  async getHeatingThresholdTemperature() {
    return await this.get().then((x) => x.heatThresh);
  }

  async getFanActive() {
    return await this.get().then((x) => x.fan);
  }

  async getTargetTemperature() {
    return await this.get().then((x) => x.targetTemp);
  }

  // setters

  async setTargetTemperature(value: CharacteristicValue) {
    return await this.set({ targetTemp: Number(value) });
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    return await this.set({ mode: Number(value) });
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue) {
    return await this.set({ coolTemp: Number(value) });
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue) {
    return await this.set({ heatTemp: Number(value) });
  }

  async setFanActive(value: CharacteristicValue) {
    return await this.set({ fan: Number(value) });
  }
}
//   // set accessory information
//   this.accessory
//     .getService(this.platform.Service.AccessoryInformation)!
//     .setCharacteristic(
//       this.platform.Characteristic.Manufacturer,
//       "Default-Manufacturer"
//     )
//     .setCharacteristic(this.platform.Characteristic.Model, "Default-Model")
//     .setCharacteristic(
//       this.platform.Characteristic.SerialNumber,
//       "Default-Serial"
//     );

//   // get the LightBulb service if it exists, otherwise create a new LightBulb service
//   // you can create multiple services for each accessory

//   if (accessory.context.device.CustomService) {
//     // This is only required when using Custom Services and Characteristics not support by HomeKit
//     this.service =
//       this.accessory.getService(
//         this.platform.CustomServices[accessory.context.device.CustomService]
//       ) ||
//       this.accessory.addService(
//         this.platform.CustomServices[accessory.context.device.CustomService]
//       );
//   } else {
//     this.service =
//       this.accessory.getService(this.platform.Service.Lightbulb) ||
//       this.accessory.addService(this.platform.Service.Lightbulb);
//   }

//   // set the service name, this is what is displayed as the default name on the Home app
//   // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
//   this.service.setCharacteristic(
//     this.platform.Characteristic.Name,
//     accessory.context.device.exampleDisplayName
//   );

//   // each service must implement at-minimum the "required characteristics" for the given service type
//   // see https://developers.homebridge.io/#/service/Lightbulb

//   // register handlers for the On/Off Characteristic
//   this.service
//     .getCharacteristic(this.platform.Characteristic.On)
//     .onSet(this.setOn.bind(this)) // SET - bind to the `setOn` method below
//     .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below

//   // register handlers for the Brightness Characteristic
//   this.service
//     .getCharacteristic(this.platform.Characteristic.Brightness)
//     .onSet(this.setBrightness.bind(this)); // SET - bind to the `setBrightness` method below

//   /**
//    * Creating multiple services of the same type.
//    *
//    * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
//    * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
//    * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
//    *
//    * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
//    * can use the same subtype id.)
//    */

//   // Example: add two "motion sensor" services to the accessory
//   const motionSensorOneService =
//     this.accessory.getService("Motion Sensor One Name") ||
//     this.accessory.addService(
//       this.platform.Service.MotionSensor,
//       "Motion Sensor One Name",
//       "YourUniqueIdentifier-1"
//     );

//   const motionSensorTwoService =
//     this.accessory.getService("Motion Sensor Two Name") ||
//     this.accessory.addService(
//       this.platform.Service.MotionSensor,
//       "Motion Sensor Two Name",
//       "YourUniqueIdentifier-2"
//     );

//   /**
//    * Updating characteristics values asynchronously.
//    *
//    * Example showing how to update the state of a Characteristic asynchronously instead
//    * of using the `on('get')` handlers.
//    * Here we change update the motion sensor trigger states on and off every 10 seconds
//    * the `updateCharacteristic` method.
//    *
//    */
//   let motionDetected = false;
//   setInterval(() => {
//     // EXAMPLE - inverse the trigger
//     motionDetected = !motionDetected;

//     // push the new value to HomeKit
//     motionSensorOneService.updateCharacteristic(
//       this.platform.Characteristic.MotionDetected,
//       motionDetected
//     );
//     motionSensorTwoService.updateCharacteristic(
//       this.platform.Characteristic.MotionDetected,
//       !motionDetected
//     );

//     this.platform.log.debug(
//       "Triggering motionSensorOneService:",
//       motionDetected
//     );
//     this.platform.log.debug(
//       "Triggering motionSensorTwoService:",
//       !motionDetected
//     );
//   }, 10000);
// }

// /**
//  * Handle "SET" requests from HomeKit
//  * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
//  */
// async setOn(value: CharacteristicValue) {
//   // implement your own code to turn your device on/off
//   this.exampleStates.On = value as boolean;

//   this.platform.log.debug("Set Characteristic On ->", value);
// }

// /**
//  * Handle the "GET" requests from HomeKit
//  * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
//  *
//  * GET requests should return as fast as possible. A long delay here will result in
//  * HomeKit being unresponsive and a bad user experience in general.
//  *
//  * If your device takes time to respond you should update the status of your device
//  * asynchronously instead using the `updateCharacteristic` method instead.
//  * In this case, you may decide not to implement `onGet` handlers, which may speed up
//  * the responsiveness of your device in the Home app.

//  * @example
//  * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
//  */
// async getOn(): Promise<CharacteristicValue> {
//   // implement your own code to check if the device is on
//   const isOn = this.exampleStates.On;

//   this.platform.log.debug("Get Characteristic On ->", isOn);

//   // if you need to return an error to show the device as "Not Responding" in the Home app:
//   // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

//   return isOn;
// }

// /**
//  * Handle "SET" requests from HomeKit
//  * These are sent when the user changes the state of an accessory, for example, changing the Brightness
//  */
// async setBrightness(value: CharacteristicValue) {
//   // implement your own code to set the brightness
//   this.exampleStates.Brightness = value as number;

//   this.platform.log.debug("Set Characteristic Brightness -> ", value);
// }
// }
