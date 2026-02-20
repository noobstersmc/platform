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

