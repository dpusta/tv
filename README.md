# Pocket Remote

A self-hosted mobile web remote for Chromecast with Google TV and other Android TV devices using Remote Service v2.

## Run

Requirements: Node.js 20+ and a server on the same local network as the Chromecast.

```sh
npm install
npm start
```

Open `http://<server-ip>:3000` on a phone. On first use, tap **Pair this TV** and enter the code displayed on the TV. Pairing credentials are saved in `data/remote.json` and are excluded from git.

The Chromecast must expose Android TV Remote Service ports 6466 and 6467, and mDNS traffic must reach the server. Docker deployments therefore generally need host networking.

## Configuration

- `PORT`: HTTP port, default `3000`
- `CHROMECAST_HOST`: optional fixed Chromecast IP, bypassing mDNS discovery
- `CHROMECAST_NAME`: optional display name used with `CHROMECAST_HOST`

## systemd

Install dependencies and then install the service from the project directory:

```sh
npm install --omit=dev
chmod +x deploy/install-systemd.sh
./deploy/install-systemd.sh
```

The installer runs the service as the current user, enables it at boot, and starts it immediately. To choose another account or Node.js binary:

```sh
SERVICE_USER=pocket-remote NODE_BIN=/usr/bin/node ./deploy/install-systemd.sh
```

Runtime settings live in `/etc/pocket-remote.env`. After editing that file, restart the service:

```sh
sudo systemctl restart pocket-remote
sudo systemctl status pocket-remote
journalctl -u pocket-remote -f
```

For reliable discovery, the Linux host must permit mDNS multicast on UDP port 5353. If discovery is unavailable, set `CHROMECAST_HOST` to the Chromecast's reserved IP in `/etc/pocket-remote.env`.

## Limits

- This controls **Chromecast with Google TV**, not older cast-only Chromecast models.
- Power-on only works while the Chromecast remains network-reachable (usually when powered independently from the TV). HDMI-CEC must be enabled for the TV itself to follow power and volume commands.
- The app intentionally selects the first discovered compatible device.
