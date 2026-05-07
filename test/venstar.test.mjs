import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildControlFromChange,
  mapVenstarToHomeKit,
  parseVenstarInfo,
  VenstarMode,
} from "../dist/venstar.js";

const fahrenheitInfo = {
  name: "Hallway",
  mode: 1,
  state: 1,
  fan: 0,
  fanstate: 0,
  tempunits: 0,
  spacetemp: 70,
  heattemp: 68,
  cooltemp: 76,
};

describe("Venstar mapping", () => {
  it("maps Fahrenheit thermostat values into HomeKit Celsius characteristics", () => {
    const values = mapVenstarToHomeKit(parseVenstarInfo(fahrenheitInfo));

    assert.equal(values.temperatureDisplayUnits, 1);
    assert.equal(values.currentHeatingCoolingState, 1);
    assert.equal(values.targetHeatingCoolingState, 1);
    assert.equal(values.currentTemperature, 21.11);
    assert.equal(values.heatTemperature, 20);
    assert.equal(values.coolTemperature, 24.44);
    assert.equal(values.targetTemperature, 20);
    assert.equal(values.fanActive, 0);
  });

  it("uses Venstar running state, not target mode, for current heating/cooling", () => {
    const values = mapVenstarToHomeKit(
      parseVenstarInfo({
        ...fahrenheitInfo,
        mode: 3,
        state: 0,
      }),
    );

    assert.equal(values.targetHeatingCoolingState, 3);
    assert.equal(values.currentHeatingCoolingState, 0);
  });

  it("preserves an auto-mode deadband when changing target temperature", () => {
    const current = mapVenstarToHomeKit(
      parseVenstarInfo({
        ...fahrenheitInfo,
        mode: 3,
        heattemp: 68,
        cooltemp: 76,
      }),
    );

    const control = buildControlFromChange(current, {
      targetTemperature: 22,
    });

    assert.deepEqual(control, {
      mode: VenstarMode.Auto,
      fan: 0,
      heattemp: 67.6,
      cooltemp: 75.6,
    });
  });

  it("builds complete control payloads while preserving unchanged values", () => {
    const current = mapVenstarToHomeKit(parseVenstarInfo(fahrenheitInfo));
    const control = buildControlFromChange(current, {
      mode: VenstarMode.Cool,
      coolTemperature: 25,
    });

    assert.deepEqual(control, {
      mode: VenstarMode.Cool,
      fan: 0,
      heattemp: 68,
      cooltemp: 77,
    });
  });
});
