import dgram from "node:dgram";

export interface SsdpDevice {
  readonly location: string;
  readonly usn?: string;
}

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;

export async function discoverSsdpDevices(
  searchTarget: string,
  timeoutMs: number,
): Promise<SsdpDevice[]> {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const devices = new Map<string, SsdpDevice>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(() => finish(), timeoutMs);

    socket.on("message", (message) => {
      const device = parseSsdpResponse(message);
      if (device) {
        devices.set(device.usn ?? device.location, device);
      }
    });

    socket.on("error", finish);

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(2);
      socket.send(searchMessage(searchTarget), SSDP_PORT, SSDP_ADDRESS, (error) => {
        if (error) {
          finish(error);
        }
      });
    });
  });

  return [...devices.values()];
}

function searchMessage(searchTarget: string): Buffer {
  return Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${searchTarget}`,
      "",
      "",
    ].join("\r\n"),
  );
}

function parseSsdpResponse(message: Buffer): SsdpDevice | undefined {
  const headers = new Map<string, string>();

  for (const line of message.toString("utf8").split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    headers.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    );
  }

  const location = headers.get("location");
  if (!location) {
    return undefined;
  }

  return {
    location,
    usn: headers.get("usn"),
  };
}
