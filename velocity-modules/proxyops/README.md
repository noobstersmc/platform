# ProxyOps (Velocity)

In-proxy operational commands for Kubernetes-based Velocity pods.

## Commands
- `/proxyops where` - show current proxy pod.
- `/proxyops list` - list proxy pods (`velocity-0/1/2`) with readiness.
- `/proxyops go <pod-name>` - transfer yourself to a specific proxy pod.
- `/proxyops servers` - list discovered backend servers registered in Velocity.
- `/proxyops default` - show current default join key and resolved server.
- `/proxyops default <name>` - set default join key cluster-wide.
- `/proxyops scale <lobby|survival|creative> <replicas>` - runtime scale test for backend workloads.
- `/proxyops update` - trigger rollout restart of configured workload.

Aliases: `/proxy`, `/pops`

## Permissions
- `proxyops.use`
- `proxyops.update`

## Discovery behavior
- Watches services labeled `mc.noobsters.net/velocity-discovery=enabled`.
- Registers one Velocity backend per ready endpoint.
- Names are short and pod-aware, for example:
  - `lobby-0-3ed187`
  - `lobby-1-51b5b0`
  - `survival-g8z8l-c6d370`
  - `creative-hhrs2-ed518f`
- Discovery reacts in near real-time via Kubernetes endpoint watch events.
- Periodic sync still runs every `PROXY_DISCOVERY_INTERVAL_SECONDS` as a safety fallback.

## Default join routing
- Runtime key comes from ConfigMap `proxyops-runtime` key `defaultServer`.
- Resolution rules:
  - exact server name match first
  - else prefix match (`<key>-...`) against discovered names
  - else fallback to static `limbo`

## Runtime env vars
- `POD_NAME`
- `POD_NAMESPACE` (default `minecraft`)
- `PROXY_WORKLOAD` (default `velocity`)
- `PROXY_WORKLOAD_KIND` (`deployment` or `statefulset`, default `statefulset`)
- `PROXY_PORT` (default `25577`)
- `PROXY_TRANSFER_HOST`
- `PROXY_TRANSFER_PORT` (default `25577`)
- `PROXY_TARGET_HOST`
- `PROXY_TARGET_BASE_PORT` (default `25578`)
- `PROXY_HAPROXY_PROTOCOL_REQUIRED` (default `true`)
- `PROXY_DISCOVERY_ENABLED` (default `true`)
- `PROXY_DISCOVERY_LABEL_KEY` (default `mc.noobsters.net/velocity-discovery`)
- `PROXY_DISCOVERY_LABEL_VALUE` (default `enabled`)
- `PROXY_DISCOVERY_NAME_PREFIX` (default `auto-`, set empty for none)
- `PROXY_DISCOVERY_INTERVAL_SECONDS` (default `5`)
- `PROXY_DISCOVERY_WATCH_ENABLED` (default `true`)
- `PROXY_RUNTIME_CONFIGMAP` (default `proxyops-runtime`)

## Build
```bash
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
```

Jar output:
- `target/ProxyOps.jar`
