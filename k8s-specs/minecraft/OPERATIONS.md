# Minecraft Operations

For end-to-end operational steps, see `minecraft/RUNBOOK.md`.

## Entry points
- Load-balanced proxy service: `svc/velocity-proxy`
- Active proxy workload: `statefulset/velocity` with 3 replicas (`velocity-0/1/2`)
- NodePorts on `svc/velocity-proxy`:
  - `31577` -> round-robin LB
  - `31578` -> pinned `velocity-0`
  - `31579` -> pinned `velocity-1`
  - `31580` -> pinned `velocity-2`

## Proxy draining behavior
- Velocity pods use `preStop` to:
  - mark draining (`/tmp/draining`)
  - wait for endpoint removal
  - run `draintransfer <target> all 3` (title countdown + transfer)
  - run a second `transfer` sweep as fallback
- Readiness fails when `/tmp/draining` exists, so new traffic is stopped before transfer.
- `terminationGracePeriodSeconds` is `120`.
- Velocity has `accepts-transfers = true`.

## ProxyOps plugin
- Source: `velocity-modules/proxyops/`
- Commands:
  - `/proxyops where`
  - `/proxyops list`
  - `/proxyops servers`
  - `/proxyops go <pod-name>`
  - `/proxyops default [name]`
  - `/proxyops update`
- Aliases: `/proxy`, `/pops`
- Dynamic backend discovery:
  - Services labeled `mc.noobsters.net/velocity-discovery=enabled`
  - Names are short pod-aware names (for example `lobby-0-3ed187`)

## Redis sync for proxy presence/counts
- Redis service: `svc/redis` (`deployment/redis`)
- Velocity runs `RedisBungee-Proxy-Velocity` on each proxy pod.
- RedisBungee config path in pod: `/plugins/redisbungee/config.yml`
- Verify RedisBungee init:
  - `kubectl -n minecraft logs velocity-0 | grep -E \"Successfully connected to Redis|RedisBungee initialized successfully\"`

## Static vs dynamic backends
- Velocity static config keeps only `limbo`.
- Gameplay servers (`lobby-*`, `survival-*`, `creative-*`) are dynamic.
- Default join target is controlled at runtime via `configmap/proxyops-runtime` key `defaultServer`.

## Auth and forwarding
- Velocity: `online-mode=true`, `player-info-forwarding-mode="modern"`
- Shared forwarding secret: `secret/velocity-forwarding-secret` key `forwarding.secret`
- Paper backends: `online-mode=false`, forwarding enabled in `paper-global.yml`
