# k8s-specs

Kubernetes manifests and rollout procedures for NoobstersMC environments.

## Current stack
- `kind` local cluster (Kubernetes `v1.34.x`)
- Velocity proxies (3 pods)
- HAProxy in-cluster TCP load balancer
- 3 PaperMC backend servers (`lobby`, `survival`, `creative`)

## Manifests
- `minecraft/velocity-papermc.yaml`

## Apply
```bash
kubectl apply -f minecraft/velocity-papermc.yaml
```

## Verify
```bash
kubectl -n minecraft get deploy,svc,pods
```
