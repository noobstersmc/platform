# ProxyOps (Velocity)

In-proxy operational commands for Kubernetes-based Velocity pods.

## Commands
- `/proxyops where` - show current pod name.
- `/proxyops list` - list available proxy pods (name/ip/ready).
- `/proxyops go <pod-name>` - transfer yourself to a specific proxy pod.
- `/proxyops update` - trigger rollout restart for deployment (`velocity-3` by default).

Aliases: `/proxy`, `/pops`

## Permissions
- `proxyops.use`
- `proxyops.update`

## Runtime env vars
- `POD_NAME` (required for accurate `where` output)
- `POD_NAMESPACE` (default: `minecraft`)
- `PROXY_DEPLOYMENT` (default: `velocity-3`)
- `PROXY_PORT` (default: `25577`)

## Build
```bash
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
```

Jar output:
- `target/ProxyOps.jar`
