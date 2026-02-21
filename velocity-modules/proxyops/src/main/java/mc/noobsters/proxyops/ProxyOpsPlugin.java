package mc.noobsters.proxyops;

import com.google.inject.Inject;
import com.velocitypowered.api.command.CommandMeta;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.player.PlayerChooseInitialServerEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.permission.Tristate;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Plugin(id = "proxyops", name = "ProxyOps", version = "0.1.0", authors = {"noobstersmc"})
public class ProxyOpsPlugin {
    private final ProxyServer proxy;
    private final Logger logger;
    private final String podName;
    private final int proxyPort;
    private final String namespace;
    private final String workload;
    private final String workloadKind;
    private final String transferHost;
    private final int transferPort;
    private final String targetHost;
    private final int targetBasePort;
    private final boolean haproxyProtocolRequired;
    private final boolean discoveryEnabled;
    private final String discoveryLabelKey;
    private final String discoveryLabelValue;
    private final String discoveryNamePrefix;
    private final long discoveryIntervalSeconds;
    private final boolean discoveryWatchEnabled;
    private final String runtimeConfigMap;
    private final Set<String> managedDiscoveredServers = new HashSet<>();
    private final AtomicLong nextWatchSyncAtMillis = new AtomicLong(0);
    private volatile String defaultServerKey = "limbo";
    private KubernetesClient k8s;

    @Inject
    public ProxyOpsPlugin(ProxyServer proxy, Logger logger) {
        this.proxy = proxy;
        this.logger = logger;
        this.podName = envOr("POD_NAME", "unknown-pod");
        this.proxyPort = Integer.parseInt(envOr("PROXY_PORT", "25577"));
        this.namespace = envOr("POD_NAMESPACE", "minecraft");
        this.workload = envOr("PROXY_WORKLOAD", "velocity");
        this.workloadKind = envOr("PROXY_WORKLOAD_KIND", "statefulset");
        this.transferHost = envOr("PROXY_TRANSFER_HOST", "");
        this.transferPort = Integer.parseInt(envOr("PROXY_TRANSFER_PORT", String.valueOf(proxyPort)));
        this.targetHost = envOr("PROXY_TARGET_HOST", transferHost);
        this.targetBasePort = Integer.parseInt(envOr("PROXY_TARGET_BASE_PORT", "25578"));
        this.haproxyProtocolRequired = Boolean.parseBoolean(envOr("PROXY_HAPROXY_PROTOCOL_REQUIRED", "true"));
        this.discoveryEnabled = Boolean.parseBoolean(envOr("PROXY_DISCOVERY_ENABLED", "true"));
        this.discoveryLabelKey = envOr("PROXY_DISCOVERY_LABEL_KEY", "mc.noobsters.net/velocity-discovery");
        this.discoveryLabelValue = envOr("PROXY_DISCOVERY_LABEL_VALUE", "enabled");
        this.discoveryNamePrefix = envOrAllowBlank("PROXY_DISCOVERY_NAME_PREFIX", "auto-");
        this.discoveryIntervalSeconds = Long.parseLong(envOr("PROXY_DISCOVERY_INTERVAL_SECONDS", "5"));
        this.discoveryWatchEnabled = Boolean.parseBoolean(envOr("PROXY_DISCOVERY_WATCH_ENABLED", "true"));
        this.runtimeConfigMap = envOr("PROXY_RUNTIME_CONFIGMAP", "proxyops-runtime");
    }

    @Subscribe
    public void onInit(ProxyInitializeEvent event) {
        this.k8s = KubernetesClient.inCluster(logger);
        CommandMeta meta = proxy.getCommandManager().metaBuilder("proxyops")
                .aliases("proxy", "pops")
                .plugin(this)
                .build();
        proxy.getCommandManager().register(meta, new ProxyOpsCommand());
        logger.info("ProxyOps loaded on pod {}", podName);
        reconcileState();
        proxy.getScheduler().buildTask(this, this::reconcileState)
                .repeat(Duration.ofSeconds(Math.max(3, discoveryIntervalSeconds)))
                .schedule();
        if (discoveryEnabled) {
            logger.info("ProxyOps discovery enabled: label {}={}", discoveryLabelKey, discoveryLabelValue);
            if (discoveryWatchEnabled) {
                startDiscoveryWatchLoop();
            }
        }
    }

    @Subscribe
    public void onChooseInitialServer(PlayerChooseInitialServerEvent event) {
        resolveDefaultServer().ifPresent(event::setInitialServer);
    }

    private void reconcileState() {
        refreshDefaultServerKey();
        if (discoveryEnabled) {
            syncDiscoveredServers();
        }
    }

    private synchronized void syncDiscoveredServers() {
        List<KubernetesClient.BackendRef> refs = k8s.listDiscoverableBackends(namespace, discoveryLabelKey, discoveryLabelValue);
        Map<String, ServerInfo> desired = new HashMap<>();
        for (KubernetesClient.BackendRef ref : refs) {
            if (ref.readyEndpoints() <= 0) {
                continue;
            }
            String name = discoveryNamePrefix + ref.name();
            ServerInfo info = new ServerInfo(name, InetSocketAddress.createUnresolved(ref.host(), ref.port()));
            desired.put(name, info);
        }

        for (ServerInfo info : desired.values()) {
            Optional<RegisteredServer> existing = proxy.getServer(info.getName());
            if (existing.isPresent()) {
                if (!managedDiscoveredServers.contains(info.getName())) {
                    // Do not override statically configured servers with the same name.
                    continue;
                }
                InetSocketAddress old = existing.get().getServerInfo().getAddress();
                if (old.getHostString().equals(info.getAddress().getHostString()) && old.getPort() == info.getAddress().getPort()) {
                    managedDiscoveredServers.add(info.getName());
                    continue;
                }
                proxy.unregisterServer(existing.get().getServerInfo());
            }
            proxy.registerServer(info);
            managedDiscoveredServers.add(info.getName());
        }

        List<String> stale = managedDiscoveredServers.stream()
                .filter(name -> !desired.containsKey(name))
                .toList();
        for (String name : stale) {
            Optional<RegisteredServer> existing = proxy.getServer(name);
            existing.ifPresent(server -> proxy.unregisterServer(server.getServerInfo()));
            managedDiscoveredServers.remove(name);
        }
    }

    private void startDiscoveryWatchLoop() {
        Thread t = new Thread(() -> {
            logger.info("ProxyOps endpoint watch enabled for discovery");
            while (true) {
                boolean ok = k8s.watchDiscoverableEndpointEvents(
                        namespace,
                        discoveryLabelKey,
                        discoveryLabelValue,
                        this::triggerWatchSync
                );
                if (!ok) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
        }, "proxyops-endpoint-watch");
        t.setDaemon(true);
        t.start();
    }

    private void triggerWatchSync() {
        long now = System.currentTimeMillis();
        long gate = nextWatchSyncAtMillis.get();
        if (now < gate) {
            return;
        }
        long next = now + 1000;
        if (!nextWatchSyncAtMillis.compareAndSet(gate, next)) {
            return;
        }
        syncDiscoveredServers();
    }

    private void refreshDefaultServerKey() {
        String value = k8s.getConfigMapKey(namespace, runtimeConfigMap, "defaultServer");
        if (value != null && !value.isBlank()) {
            defaultServerKey = value.trim();
        }
    }

    private Optional<RegisteredServer> resolveDefaultServer() {
        String desired = defaultServerKey;
        Optional<RegisteredServer> exact = proxy.getServer(desired);
        if (exact.isPresent()) {
            return exact;
        }
        List<String> matches = managedDiscoveredServers.stream()
                .filter(n -> n.equals(desired) || n.startsWith(desired + "-"))
                .sorted()
                .toList();
        if (!matches.isEmpty()) {
            return proxy.getServer(matches.get(0));
        }
        return proxy.getServer("limbo");
    }

    private String envOr(String key, String def) {
        String v = System.getenv(key);
        return (v == null || v.isBlank()) ? def : v;
    }

    private String envOrAllowBlank(String key, String def) {
        String v = System.getenv(key);
        return v == null ? def : v;
    }

    private final class ProxyOpsCommand implements SimpleCommand {
        @Override
        public void execute(Invocation invocation) {
            String[] args = invocation.arguments();
            if (args.length == 0) {
                usage(invocation);
                return;
            }
            switch (args[0].toLowerCase()) {
                case "where" -> where(invocation);
                case "list" -> list(invocation);
                case "go" -> go(invocation);
                case "update" -> update(invocation);
                case "servers" -> servers(invocation);
                case "default" -> setDefault(invocation);
                case "scale" -> scale(invocation);
                default -> usage(invocation);
            }
        }

        @Override
        public boolean hasPermission(Invocation invocation) {
            return invocation.source().getPermissionValue("proxyops.use") != Tristate.FALSE;
        }

        private void usage(Invocation inv) {
            inv.source().sendMessage(Component.text("/proxyops where | list | servers | default [name] | scale <lobby|survival|creative> <replicas> | go <pod-name> | update", NamedTextColor.YELLOW));
        }

        private void where(Invocation inv) {
            inv.source().sendMessage(Component.text("Current proxy pod: " + podName, NamedTextColor.GREEN));
        }

        private void list(Invocation inv) {
            List<KubernetesClient.PodRef> pods = k8s.listVelocityPods(namespace);
            if (pods.isEmpty()) {
                inv.source().sendMessage(Component.text("No proxy pods found.", NamedTextColor.RED));
                return;
            }
            pods.sort(Comparator.comparing(KubernetesClient.PodRef::name));
            inv.source().sendMessage(Component.text("Available proxy pods:", NamedTextColor.AQUA));
            for (KubernetesClient.PodRef pod : pods) {
                NamedTextColor c = pod.name().equals(podName) ? NamedTextColor.GOLD : NamedTextColor.GRAY;
                inv.source().sendMessage(Component.text("- " + pod.name() + "  ip=" + pod.podIp() + "  ready=" + pod.ready(), c));
            }
        }

        private void go(Invocation inv) {
            if (!(inv.source() instanceof Player player)) {
                inv.source().sendMessage(Component.text("Only players can use /proxyops go", NamedTextColor.RED));
                return;
            }
            String[] args = inv.arguments();
            if (args.length < 2) {
                inv.source().sendMessage(Component.text("Usage: /proxyops go <pod-name>", NamedTextColor.YELLOW));
                return;
            }
            String target = args[1];
            List<KubernetesClient.PodRef> pods = k8s.listVelocityPods(namespace);
            Optional<KubernetesClient.PodRef> maybe = pods.stream()
                    .filter(p -> p.name().equals(target))
                    .findFirst();
            if (maybe.isEmpty()) {
                inv.source().sendMessage(Component.text("Pod not found: " + target, NamedTextColor.RED));
                return;
            }
            KubernetesClient.PodRef pod = maybe.get();
            if (!pod.ready() || pod.podIp().isBlank()) {
                inv.source().sendMessage(Component.text("Target pod not ready: " + target, NamedTextColor.RED));
                return;
            }
            if (pod.name().equals(podName)) {
                inv.source().sendMessage(Component.text("You are already on this proxy pod.", NamedTextColor.YELLOW));
                return;
            }
            if (haproxyProtocolRequired) {
                Integer ordinal = parseOrdinal(pod.name());
                if (ordinal != null && !targetHost.isBlank()) {
                    int targetPort = targetBasePort + ordinal;
                    player.transferToHost(InetSocketAddress.createUnresolved(targetHost, targetPort));
                    inv.source().sendMessage(Component.text(
                            "Transferring you to " + pod.name() + " via " + targetHost + ":" + targetPort,
                            NamedTextColor.GREEN));
                    return;
                }
                if (transferHost.isBlank()) {
                    inv.source().sendMessage(Component.text(
                            "Direct pod transfer is disabled: this proxy requires HAProxy PROXY protocol.",
                            NamedTextColor.RED));
                    return;
                }
                player.transferToHost(InetSocketAddress.createUnresolved(transferHost, transferPort));
                inv.source().sendMessage(Component.text(
                        "Transferring via LB " + transferHost + ":" + transferPort +
                                " (cannot pin exact pod when HAProxy protocol is enabled).",
                        NamedTextColor.GREEN));
                return;
            }

            player.transferToHost(InetSocketAddress.createUnresolved(pod.podIp(), proxyPort));
            inv.source().sendMessage(Component.text("Transferring you to " + pod.name(), NamedTextColor.GREEN));
        }

        private void update(Invocation inv) {
            if (inv.source().getPermissionValue("proxyops.update") == Tristate.FALSE) {
                inv.source().sendMessage(Component.text("Missing permission: proxyops.update", NamedTextColor.RED));
                return;
            }
            boolean ok = k8s.restartWorkload(namespace, workload, workloadKind, Instant.now().toString());
            if (ok) {
                inv.source().sendMessage(Component.text("Triggered rollout restart for " + workloadKind + "/" + workload, NamedTextColor.GREEN));
            } else {
                inv.source().sendMessage(Component.text("Failed to trigger rollout restart. Check plugin logs.", NamedTextColor.RED));
            }
        }

        private void servers(Invocation inv) {
            List<String> names = managedDiscoveredServers.stream().sorted().toList();
            if (names.isEmpty()) {
                inv.source().sendMessage(Component.text("No discovered backends currently registered.", NamedTextColor.YELLOW));
                return;
            }
            inv.source().sendMessage(Component.text("Discovered backends:", NamedTextColor.AQUA));
            for (String n : names) {
                inv.source().sendMessage(Component.text("- " + n, NamedTextColor.GRAY));
            }
        }

        private void setDefault(Invocation inv) {
            String[] args = inv.arguments();
            if (args.length == 1) {
                Optional<RegisteredServer> resolved = resolveDefaultServer();
                String resolvedName = resolved.map(s -> s.getServerInfo().getName()).orElse("none");
                inv.source().sendMessage(Component.text(
                        "Default key: " + defaultServerKey + " (resolves to " + resolvedName + ")",
                        NamedTextColor.AQUA));
                return;
            }
            if (inv.source().getPermissionValue("proxyops.update") == Tristate.FALSE) {
                inv.source().sendMessage(Component.text("Missing permission: proxyops.update", NamedTextColor.RED));
                return;
            }
            String desired = args[1].trim();
            if (desired.isEmpty()) {
                inv.source().sendMessage(Component.text("Usage: /proxyops default <name>", NamedTextColor.YELLOW));
                return;
            }
            boolean ok = k8s.patchConfigMapKey(namespace, runtimeConfigMap, "defaultServer", desired);
            if (!ok) {
                inv.source().sendMessage(Component.text("Failed to update default server key.", NamedTextColor.RED));
                return;
            }
            defaultServerKey = desired;
            Optional<RegisteredServer> resolved = resolveDefaultServer();
            String resolvedName = resolved.map(s -> s.getServerInfo().getName()).orElse("none");
            inv.source().sendMessage(Component.text(
                    "Default key set to " + desired + " (resolves to " + resolvedName + ")",
                    NamedTextColor.GREEN));
        }

        private void scale(Invocation inv) {
            if (inv.source().getPermissionValue("proxyops.update") == Tristate.FALSE) {
                inv.source().sendMessage(Component.text("Missing permission: proxyops.update", NamedTextColor.RED));
                return;
            }
            String[] args = inv.arguments();
            if (args.length < 3) {
                inv.source().sendMessage(Component.text(
                        "Usage: /proxyops scale <lobby|survival|creative> <replicas>",
                        NamedTextColor.YELLOW));
                return;
            }
            String target = args[1].toLowerCase();
            int replicas;
            try {
                replicas = Integer.parseInt(args[2]);
            } catch (NumberFormatException e) {
                inv.source().sendMessage(Component.text("Replicas must be an integer.", NamedTextColor.RED));
                return;
            }
            if (replicas < 0 || replicas > 10) {
                inv.source().sendMessage(Component.text("Replicas must be between 0 and 10.", NamedTextColor.RED));
                return;
            }

            String workload;
            String kind;
            switch (target) {
                case "lobby" -> {
                    workload = "paper-lobby";
                    kind = "statefulset";
                }
                case "survival" -> {
                    workload = "paper-survival";
                    kind = "deployment";
                }
                case "creative" -> {
                    workload = "paper-creative";
                    kind = "deployment";
                }
                default -> {
                    inv.source().sendMessage(Component.text("Target must be lobby, survival, or creative.", NamedTextColor.RED));
                    return;
                }
            }

            boolean ok = k8s.scaleWorkload(namespace, workload, kind, replicas);
            if (!ok) {
                inv.source().sendMessage(Component.text("Scale request failed. Check plugin logs.", NamedTextColor.RED));
                return;
            }
            inv.source().sendMessage(Component.text(
                    "Scaled " + kind + "/" + workload + " to " + replicas
                            + " (runtime only; declarative specs unchanged).",
                    NamedTextColor.GREEN));
        }

        @Override
        public List<String> suggest(Invocation invocation) {
            String[] args = invocation.arguments();
            if (args.length == 0) {
                return List.of("where", "list", "servers", "default", "scale", "go", "update");
            }
            if (args.length == 1) {
                return List.of("where", "list", "servers", "default", "scale", "go", "update").stream()
                        .filter(s -> s.startsWith(args[0].toLowerCase()))
                        .toList();
            }
            if (args.length == 2 && "default".equalsIgnoreCase(args[0])) {
                List<String> out = new ArrayList<>();
                out.add("lobby");
                out.add("survival");
                out.add("creative");
                out.add("limbo");
                out.addAll(managedDiscoveredServers.stream().sorted().toList());
                return out.stream().filter(s -> s.startsWith(args[1])).toList();
            }
            if (args.length == 2 && "go".equalsIgnoreCase(args[0])) {
                List<String> out = new ArrayList<>();
                for (KubernetesClient.PodRef pod : k8s.listVelocityPods(namespace)) {
                    if (pod.name().startsWith(args[1])) {
                        out.add(pod.name());
                    }
                }
                return out;
            }
            if (args.length == 2 && "scale".equalsIgnoreCase(args[0])) {
                return List.of("lobby", "survival", "creative").stream()
                        .filter(s -> s.startsWith(args[1].toLowerCase()))
                        .toList();
            }
            return List.of();
        }

        private Integer parseOrdinal(String pod) {
            Matcher m = Pattern.compile(".*-(\\d+)$").matcher(pod);
            if (!m.matches()) {
                return null;
            }
            try {
                return Integer.parseInt(m.group(1));
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
