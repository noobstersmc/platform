# k8s-specs

Kubernetes manifests and rollout procedures for NoobstersMC environments.

## Current stack
- `kind` local cluster (Kubernetes `v1.34.x`)
- Velocity proxies (3 pods)
- HAProxy in-cluster TCP load balancer
- 3 PaperMC backend servers (`lobby`, `survival`, `creative`)

## Manifests
- `minecraft/velocity-papermc.yaml`
- `minecraft/OPERATIONS.md`
- `minecraft/RUNBOOK.md`

## Apply
```bash
kubectl apply -f minecraft/velocity-papermc.yaml
```

## Verify
```bash
kubectl -n minecraft get deploy,svc,pods
```

## LAN access
```bash
kubectl -n minecraft port-forward --address 0.0.0.0 svc/velocity-proxy 25577:25577
```

## Notes
- Only `svc/velocity-proxy` is externally exposed (`NodePort`).
- Per-proxy services (`velocity-proxy-1/2/3`) are internal-only (`ClusterIP`).
- LuckPerms is configured for shared Postgres storage.
