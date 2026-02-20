# Minecraft Platform Overview

## What runs
- `statefulset/velocity` (3 replicas): `velocity-0`, `velocity-1`, `velocity-2`
- `deployment/velocity-lb` (HAProxy, 2 replicas)
- `paper-lobby`, `paper-survival`, `paper-creative`
- `luckperms-postgres`

## Traffic model
- Client entrypoint is `svc/velocity-proxy` (`NodePort`).
- HAProxy routes:
  - `25577` -> round-robin across `velocity-0/1/2`
  - `25578` -> pinned to `velocity-0`
  - `25579` -> pinned to `velocity-1`
  - `25580` -> pinned to `velocity-2`
- Velocity expects PROXY protocol from HAProxy (`haproxy-protocol=true`).

## Why StatefulSet
- Stable pod IDs (`velocity-0/1/2`) are required for deterministic, pod-targeted routes.
- Rolling updates keep identity while replacing pods in order.

## Proxy plugins
- `proxytransfer`: drain title + transfer command used during pod shutdown.
- `proxyops`: player/admin commands:
  - `/proxyops where`
  - `/proxyops list`
  - `/proxyops go <pod-name>`
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

## Local network exposure
```bash
kubectl -n minecraft port-forward --address 0.0.0.0 svc/velocity-proxy \
  25577:25577 25578:25578 25579:25579 25580:25580
```
