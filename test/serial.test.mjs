import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeKitSerialNumber } from "../dist/serial.js";

describe("HomeKit serial numbers", () => {
  it("uses the Venstar MAC address from SSDP USNs", () => {
    const serialNumber = homeKitSerialNumber(
      "ssdp:colortouch:ecp:00:9D:6B:A0:67:6B:name:PRIMARY LIVIN:type:residential",
      "colortouch:ecp:00:9D:6B:A0:67:6B:name:PRIMARY LIVIN:type:residential",
    );

    assert.equal(serialNumber, "00:9D:6B:A0:67:6B");
  });

  it("keeps short manual host IDs unchanged", () => {
    assert.equal(homeKitSerialNumber("host:192.168.1.218"), "host:192.168.1.218");
  });

  it("limits fallback serial numbers to HomeKit's maximum length", () => {
    const serialNumber = homeKitSerialNumber(
      "ssdp:colortouch:ecp:no-mac-address:name:VERY LONG THERMOSTAT NAME:type:residential",
    );

    assert.equal(serialNumber.length, 64);
    assert.equal(
      serialNumber,
      "ssdp:colortouch:ecp:no-mac-address:name:VERY LONG THERMOSTAT NAM",
    );
  });
});
