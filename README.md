# ProxyTransfer Patches

This folder stores our local patches for the upstream `VelocityTransfer` plugin:

- Upstream: `https://github.com/jessefaler/VelocityTransfer`
- Patched file: `src/TransferCommand.java`
- Patch file: `patches/0001-draintransfer-title-countdown-and-command.patch`

## What this patch adds

- `draintransfer <host:port> <all|local|player> [seconds]`
- Title animation:
  - Title: `Proxy update`
  - Subtitle: `Transferring you in N...`
- Scheduled transfer after countdown.

## Rebuild flow

```bash
git clone https://github.com/jessefaler/VelocityTransfer.git
cd VelocityTransfer
git apply /path/to/0001-draintransfer-title-countdown-and-command.patch
docker run --rm -v "$PWD":/work -w /work maven:3.9.9-eclipse-temurin-21 mvn -q -DskipTests package
```

## Deploy patched jar to cluster

```bash
kubectl -n minecraft create configmap proxytransfer-patched \
  --from-file=ProxyTransfer-1.0.jar=/path/to/VelocityTransfer/target/ProxyTransfer-1.0.jar \
  -o yaml --dry-run=client | kubectl apply -f -

kubectl -n minecraft rollout restart deploy/velocity-1 deploy/velocity-2 deploy/velocity-3
```

## Verify command availability

```bash
kubectl -n minecraft exec deploy/velocity-1 -- sh -lc \
  'rcon-cli --host 127.0.0.1 --port 25575 --password "${RCON_PASSWORD}" \
  "draintransfer 192.168.4.33:25577 all 3"'
```
