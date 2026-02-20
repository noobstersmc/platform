# Minecraft Runbook

## Prerequisites
- `kubectl` configured for the local `kind` context.
- Namespace: `minecraft`.

## Deploy or update
```bash
kubectl apply -f minecraft/velocity-papermc.yaml
kubectl -n minecraft get deploy,svc,pods
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
kubectl -n minecraft rollout restart deploy/velocity-1 deploy/velocity-2 deploy/velocity-3
kubectl -n minecraft rollout status deploy/velocity-1 --timeout=180s
kubectl -n minecraft rollout status deploy/velocity-2 --timeout=180s
kubectl -n minecraft rollout status deploy/velocity-3 --timeout=180s
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
