package mc.noobsters.proxyops;

import com.google.inject.Inject;
import com.velocitypowered.api.command.CommandMeta;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.permission.Tristate;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
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
    }

    private String envOr(String key, String def) {
        String v = System.getenv(key);
        return (v == null || v.isBlank()) ? def : v;
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
                default -> usage(invocation);
            }
        }

        @Override
        public boolean hasPermission(Invocation invocation) {
            return invocation.source().getPermissionValue("proxyops.use") != Tristate.FALSE;
        }

        private void usage(Invocation inv) {
            inv.source().sendMessage(Component.text("/proxyops where | list | go <pod-name> | update", NamedTextColor.YELLOW));
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

        @Override
        public List<String> suggest(Invocation invocation) {
            String[] args = invocation.arguments();
            if (args.length == 0) {
                return List.of("where", "list", "go", "update");
            }
            if (args.length == 1) {
                return List.of("where", "list", "go", "update").stream()
                        .filter(s -> s.startsWith(args[0].toLowerCase()))
                        .toList();
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
