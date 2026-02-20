# Minecraft Runbook

## Prerequisites
- `kubectl` configured for the local `kind` context.
- Namespace: `minecraft`.

## Deploy or update
```bash
kubectl apply -f minecraft/velocity-papermc.yaml
kubectl -n minecraft get deploy,svc,pods
```

If `velocity-modules/proxyops` changed, rebuild and refresh its configmap first:
```bash
cd velocity-modules/proxyops
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
kubectl -n minecraft delete configmap proxyops-plugin --ignore-not-found
kubectl -n minecraft create configmap proxyops-plugin --from-file=ProxyOps.jar=target/ProxyOps.jar
```

## Expose to LAN
```bash
kubectl -n minecraft port-forward --address 0.0.0.0 svc/velocity-proxy 25577:25577
```

Players connect to `<host-lan-ip>:25577`.

## Restart all deployments
```bash
kubectl -n minecraft get deploy -o name | xargs -r kubectl -n minecraft rollout restart
for d in $(kubectl -n minecraft get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'); do
  kubectl -n minecraft rollout status deploy/$d --timeout=300s || exit 1
done
```

## Drain-aware proxy rollout test
```bash
kubectl -n minecraft rollout restart statefulset/velocity
kubectl -n minecraft rollout status statefulset/velocity --timeout=300s
```

Expected behavior:
- draining proxy is removed from ready endpoints
- players receive title/subtitle countdown
- players are transferred to LB endpoint

## Validate shared LuckPerms database
```bash
kubectl -n minecraft exec deploy/luckperms-postgres -- sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt luckperms_*"'
```

## Useful checks
```bash
kubectl -n minecraft get svc velocity-proxy velocity-proxy-1 velocity-proxy-2 velocity-proxy-3 -o wide
kubectl -n minecraft get pods -o wide
kubectl -n minecraft get pdb
```

## Known limitations
- Existing TCP sessions to a pod that is terminating can still drop if transfer cannot complete in time.
- `TRANSFER_TARGET` is currently static in manifests and should be externalized for multi-host environments.
