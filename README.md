# Go Venstar

Homebridge plugin for local Venstar thermostats using the
[Venstar local API](https://developer.venstar.com/documentation/).

## Features

- Discovers Venstar thermostats with SSDP.
- Supports optional manual IP/hostname entries for thermostats that miss discovery.
- Keeps cached HomeKit accessories when a thermostat is temporarily offline.
- Uses request timeouts, state caching, and background polling to avoid slow HomeKit reads.
- Exposes thermostat mode, current temperature, target temperature, heat/cool thresholds, display units, and fan setting.

## Requirements

- Homebridge 1.8 or newer.
- Node.js 20+.
- Venstar thermostats connected to Wi-Fi.
- Local API access enabled on each thermostat.
- Homebridge running on the same local network as the thermostats.

## Setup

1. Connect each Venstar thermostat to Wi-Fi.
2. Enable local API access on each thermostat. On many Venstar models this is under the thermostat's Wi-Fi settings.
3. Make sure Homebridge is running on the same local network as the thermostats.
4. Install the plugin through Homebridge UI or with:

   ```sh
   npm install -g homebridge-go-venstar
   ```

5. Add the `GoVenstar` platform in Homebridge.

The plugin autodiscovers local Venstar thermostats with SSDP, so most installs only need the platform entry below.

Minimal config:

```json
{
  "platform": "GoVenstar",
  "name": "GoVenstar"
}
```

If autodiscovery is unreliable, add static hosts:

```json
{
  "platform": "GoVenstar",
  "name": "GoVenstar",
  "hosts": ["192.168.1.50", "192.168.1.51"]
}
```

## Options

- `discover`: enable SSDP discovery. Default: `true`.
- `hosts`: optional thermostat IP addresses or hostnames to query directly.
- `discoveryTimeoutMs`: SSDP discovery window. Default: `5000`.
- `requestTimeoutMs`: HTTP timeout for thermostat API calls. Default: `3000`.
- `pollIntervalMs`: background refresh interval. Use `0` to disable polling. Default: `30000`.
- `removeStaleAccessories`: remove cached thermostats that are not found during discovery. Default: `false`.

## Troubleshooting

If a thermostat is intermittently missing, leave `removeStaleAccessories` disabled and add the thermostat IP to `hosts`. The plugin will keep the HomeKit accessory and mark it unavailable only when API calls fail.

If HomeKit is slow to update, increase `requestTimeoutMs` only if the thermostat responds slowly. Very high values can make HomeKit feel less responsive.
