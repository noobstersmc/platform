# Minecraft Platform Overview

## What runs
- `statefulset/velocity` (3 replicas): `velocity-0`, `velocity-1`, `velocity-2`
- `deployment/velocity-lb` (HAProxy, 2 replicas)
- `statefulset/paper-lobby` (2 replicas)
- `deployment/paper-survival` (1 replica)
- `deployment/paper-creative` (1 replica)
- `deployment/paper-limbo` (1 replica)
- `deployment/luckperms-postgres` (1 replica)
- `deployment/redis` (1 replica, RedisBungee transport)

## Traffic model
- Client entrypoint is `svc/velocity-proxy` (`NodePort`).
- HAProxy routes:
  - `25577` -> round-robin across `velocity-0/1/2`
  - `25578` -> pinned `velocity-0`
  - `25579` -> pinned `velocity-1`
  - `25580` -> pinned `velocity-2`
- Velocity uses `haproxy-protocol=true`.

## Server registration model
- Velocity static config intentionally keeps only one static backend:
  - `limbo`
- All gameplay servers are discovered dynamically from Kubernetes services labeled:
  - `mc.noobsters.net/velocity-discovery=enabled`
- Dynamic names are short and pod-scoped:
  - `lobby-0-<uid6>` / `lobby-1-<uid6>`
  - `survival-<podSuffix>-<uid6>`
  - `creative-<podSuffix>-<uid6>`

## Default server routing
- Initial join routing is controlled by `proxyops` (not `try`).
- Runtime key is stored in ConfigMap:
  - `configmap/proxyops-runtime` key `defaultServer`
- Change default with:
  - `/proxyops default lobby`
  - `/proxyops default survival`
  - `/proxyops default creative`
  - `/proxyops default limbo`
- This propagates to all proxy pods automatically.

## Why StatefulSet for proxies
- Stable pod identity (`velocity-0/1/2`) is required for deterministic pinned transfer ports.
- Ordered rolling updates maintain availability while preserving identity mapping.

## Proxy plugins
- `proxytransfer`: draining title/countdown + transfer command during pod shutdown.
- `redisbungee`: cross-proxy network presence + synchronized MOTD/player-count view.
- `proxyops`:
  - `/proxyops where`
  - `/proxyops list`
  - `/proxyops servers`
  - `/proxyops go <pod-name>`
  - `/proxyops default [name]`
  - `/proxyops update`

## DNS bindings (Cloudflare)
Use **DNS only** records.

`A` records (all point to same LB/public IP):
- `play.internal.noobsters.net`
- `proxy0.internal.noobsters.net`
- `proxy1.internal.noobsters.net`
- `proxy2.internal.noobsters.net`

`SRV` records:
- `_minecraft._tcp.play.internal.noobsters.net` -> `play.internal.noobsters.net:25577`
- `_minecraft._tcp.proxy0.internal.noobsters.net` -> `proxy0.internal.noobsters.net:25578`
- `_minecraft._tcp.proxy1.internal.noobsters.net` -> `proxy1.internal.noobsters.net:25579`
- `_minecraft._tcp.proxy2.internal.noobsters.net` -> `proxy2.internal.noobsters.net:25580`
