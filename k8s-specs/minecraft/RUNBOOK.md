# Minecraft Runbook

## Prerequisites
- `kubectl` configured for local `kind` context
- Namespace: `minecraft`

## Deploy or update
```bash
kubectl apply -f minecraft/velocity-papermc.yaml
kubectl -n minecraft get deploy,sts,svc,pods
```

If `velocity-modules/proxyops` changed:
```bash
cd velocity-modules/proxyops
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
kubectl -n minecraft delete configmap proxyops-plugin --ignore-not-found
kubectl -n minecraft create configmap proxyops-plugin --from-file=ProxyOps.jar=target/ProxyOps.jar
kubectl -n minecraft rollout restart statefulset/velocity
kubectl -n minecraft rollout status statefulset/velocity --timeout=300s
```

## Expose to LAN
Preferred: use NodePorts (`31577-31580`) directly.

Optional port-forward fallback:
```bash
kubectl -n minecraft port-forward --address 0.0.0.0 svc/velocity-proxy \
  25577:25577 25578:25578 25579:25579 25580:25580
```

## Proxy rollout test (drain-aware)
```bash
kubectl -n minecraft rollout restart statefulset/velocity
kubectl -n minecraft rollout status statefulset/velocity --timeout=300s
```

Expected behavior:
- terminating proxy leaves ready endpoints first
- players receive drain title/countdown
- players are transferred to healthy proxy targets

## Default join target (runtime)
Query current value:
```bash
kubectl -n minecraft exec velocity-0 -- rcon-cli --host 127.0.0.1 --port 25575 --password 'noobstersmc-rcon-password-2026' 'proxyops default'
```

Set default target:
```bash
kubectl -n minecraft exec velocity-0 -- rcon-cli --host 127.0.0.1 --port 25575 --password 'noobstersmc-rcon-password-2026' 'proxyops default lobby'
# also valid: survival, creative, limbo, or exact discovered server name
```

Underlying source of truth:
```bash
kubectl -n minecraft get configmap proxyops-runtime -o jsonpath='{.data.defaultServer}{"\n"}'
```

## Useful checks
```bash
kubectl -n minecraft get pods -o wide
kubectl -n minecraft get svc velocity-proxy velocity-0-svc velocity-1-svc velocity-2-svc -o wide
kubectl -n minecraft exec velocity-0 -- rcon-cli --host 127.0.0.1 --port 25575 --password 'noobstersmc-rcon-password-2026' 'proxyops servers'
```

## Mineflayer client test harness
Use `tools/mc-bot` for player-perspective tests (`/server`, reconnect behavior, etc.).
See: `tools/mc-bot/README.md`

## DNS (Cloudflare)
- Use `DNS only` records
- A records to same LB/public IP:
  - `play.internal.noobsters.net`
  - `proxy0.internal.noobsters.net`
  - `proxy1.internal.noobsters.net`
  - `proxy2.internal.noobsters.net`
- SRV records:
  - `_minecraft._tcp.play.internal.noobsters.net` -> `play.internal.noobsters.net:25577`
  - `_minecraft._tcp.proxy0.internal.noobsters.net` -> `proxy0.internal.noobsters.net:25578`
  - `_minecraft._tcp.proxy1.internal.noobsters.net` -> `proxy1.internal.noobsters.net:25579`
  - `_minecraft._tcp.proxy2.internal.noobsters.net` -> `proxy2.internal.noobsters.net:25580`
