# Lobby Inspector

Paper plugin for lobby servers that lets authorized staff inspect another player's live inventory and status while in spectator mode.

## Build
```bash
mvn -DskipTests package
```

## Output
- Jar: `target/lobby-inspector-1.0.0.jar`

## Runtime behavior
- Intended for lobby pods only.
- Added into lobby pods by `k8s-specs/minecraft/velocity-papermc.yaml` via the `lobby-inspector-plugin` ConfigMap and `install-lobby-inspector` init container.
