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

To type on the TV, focus its text field first and tap the keyboard button in the remote. The app supports ASCII letters, numbers, spaces, and common password symbols. Entered text is sent immediately and is not logged or stored. The default web server uses HTTP, so only enter sensitive passwords on a trusted LAN or place an HTTPS reverse proxy in front of the app.

## Configuration

- `PORT`: HTTP port, default `3000`
- `CHROMECAST_HOST`: optional fixed Chromecast IP, bypassing mDNS discovery
- `CHROMECAST_NAME`: optional display name used with `CHROMECAST_HOST`

## Docker Compose

Docker Compose is the recommended Linux deployment. It uses host networking so mDNS discovery can see the Chromecast:

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

Open `http://<linux-host-ip>:3000`. Pairing credentials persist in the `pocket-remote-data` named volume.

To update or restart:

```sh
docker compose up -d --build
docker compose restart
```

If discovery does not find the Chromecast, assign it a reserved IP and set `CHROMECAST_HOST` in `.env`. Host networking is supported by Docker Engine on Linux; Docker Desktop environments handle it differently and are not the intended deployment target.

## systemd (alternative)

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
