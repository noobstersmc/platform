# Minecraft Operations

For end-to-end operational steps, see `minecraft/RUNBOOK.md`.

## Entry points
- Load-balanced proxy service: `svc/velocity-proxy`
- Proxy-specific services: `svc/velocity-proxy-1`, `svc/velocity-proxy-2`, `svc/velocity-proxy-3` (internal-only `ClusterIP`)
- Active proxy workload: `statefulset/velocity` with 3 replicas (`velocity-0/1/2`)
- External NodePorts on `svc/velocity-proxy`:
  - `31577` -> round-robin LB
  - `31578` -> pinned `velocity-0`
  - `31579` -> pinned `velocity-1`
  - `31580` -> pinned `velocity-2`

## Local/LAN access
```bash
kubectl -n minecraft port-forward --address 0.0.0.0 svc/velocity-proxy 25577:25577
```

## Roll restart proxies
```bash
kubectl -n minecraft rollout restart statefulset/velocity
```

## Watch rollout
```bash
kubectl -n minecraft get pods -l app=velocity -w
```

## Proxy draining behavior
- Velocity pods use `preStop` to:
  - mark draining (`/tmp/draining`)
  - wait for endpoint removal
  - run `draintransfer <lb-host:port> all 3` (title countdown + transfer)
  - run a second `transfer` sweep as a fallback
- Readiness checks fail when `/tmp/draining` exists, so Kubernetes stops sending new traffic to that pod before transfer starts.
- `terminationGracePeriodSeconds` is `120` to allow countdown + transfer + settle time.
- Velocity config has `accepts-transfers = true` for transfer-packet workflows.
- ProxyTransfer patch source is tracked in `Documents/repos/noobstersmc/velocity-modules/proxytransfer/`.

## ProxyOps plugin
- Plugin source: `velocity-modules/proxyops/`
- Commands:
  - `/proxyops where`
  - `/proxyops list`
  - `/proxyops go <pod-name>`
  - `/proxyops update`
- Aliases: `/proxy`, `/pops`

## Auth and forwarding (Velocity modern forwarding)
- Velocity is `online-mode=true`.
- Velocity uses `player-info-forwarding-mode="modern"`.
- Shared forwarding secret is in `secret/velocity-forwarding-secret` key `forwarding.secret`.
- Paper backends are `online-mode=false` and `accepts-transfers=true`.
- Paper config enables Velocity forwarding in `paper-global.yml` with the same secret.
