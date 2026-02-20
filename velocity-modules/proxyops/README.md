# ProxyOps (Velocity)

In-proxy operational commands for Kubernetes-based Velocity pods.

## Commands
- `/proxyops where` - show current pod name.
- `/proxyops list` - list available proxy pods (name/ip/ready).
- `/proxyops go <pod-name>` - transfer yourself to a specific proxy pod.
- `/proxyops update` - trigger rollout restart for deployment (`velocity-3` by default).
- `/proxyops servers` - list discovered backend servers registered in Velocity.

Aliases: `/proxy`, `/pops`

## Permissions
- `proxyops.use`
- `proxyops.update`

## Runtime env vars
- `POD_NAME` (required for accurate `where` output)
- `POD_NAMESPACE` (default: `minecraft`)
- `PROXY_WORKLOAD` (default: `velocity`)
- `PROXY_WORKLOAD_KIND` (`deployment` or `statefulset`, default: `statefulset`)
- `PROXY_PORT` (default: `25577`)
- `PROXY_TRANSFER_HOST` (normal LB host)
- `PROXY_TRANSFER_PORT` (normal LB port, default `25577`)
- `PROXY_TARGET_HOST` (targeted LB host)
- `PROXY_TARGET_BASE_PORT` (default `25578`, maps to pod ordinal)
- `PROXY_DISCOVERY_ENABLED` (default: `true`)
- `PROXY_DISCOVERY_LABEL_KEY` (default: `mc.noobsters.net/velocity-discovery`)
- `PROXY_DISCOVERY_LABEL_VALUE` (default: `enabled`)
- `PROXY_DISCOVERY_NAME_PREFIX` (default: `auto-`)
- `PROXY_DISCOVERY_INTERVAL_SECONDS` (default: `5`)

## Build
```bash
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
```

Jar output:
- `target/ProxyOps.jar`
