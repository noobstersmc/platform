package mc.noobsters.proxyops;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class KubernetesClient {
    private static final String SA_ROOT = "/var/run/secrets/kubernetes.io/serviceaccount";

    private final Logger logger;
    private final HttpClient http;
    private final String bearer;

    private KubernetesClient(Logger logger, HttpClient http, String bearer) {
        this.logger = logger;
        this.http = http;
        this.bearer = bearer;
    }

    public static KubernetesClient inCluster(Logger logger) {
        try {
            Path tokenPath = Path.of(SA_ROOT, "token");
            Path caPath = Path.of(SA_ROOT, "ca.crt");
            String token = Files.readString(tokenPath).trim();

            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            Certificate ca;
            try (var in = Files.newInputStream(caPath)) {
                ca = cf.generateCertificate(in);
            }

            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            ks.setCertificateEntry("kube-ca", ca);

            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ks);

            SSLContext ssl = SSLContext.getInstance("TLS");
            ssl.init(null, tmf.getTrustManagers(), null);

            HttpClient client = HttpClient.newBuilder()
                    .sslContext(ssl)
                    .connectTimeout(Duration.ofSeconds(5))
                    .build();
            return new KubernetesClient(logger, client, token);
        } catch (Exception e) {
            logger.error("Failed to initialize Kubernetes client", e);
            return new KubernetesClient(logger, HttpClient.newHttpClient(), "");
        }
    }

    public List<PodRef> listVelocityPods(String namespace) {
        List<PodRef> out = new ArrayList<>();
        if (bearer.isBlank()) {
            return out;
        }
        try {
            String label = URLEncoder.encode("app=velocity,proxy-id=3", StandardCharsets.UTF_8);
            String path = "/api/v1/namespaces/" + namespace + "/pods?labelSelector=" + label;
            JsonObject root = get(path);
            if (root == null) {
                return out;
            }
            JsonArray items = root.getAsJsonArray("items");
            if (items == null) {
                return out;
            }
            for (JsonElement item : items) {
                JsonObject pod = item.getAsJsonObject();
                String name = str(pod, "metadata", "name");
                String ip = str(pod, "status", "podIP");
                boolean ready = isPodReady(pod);
                out.add(new PodRef(name, ip, ready));
            }
        } catch (Exception e) {
            logger.error("Failed to list velocity pods", e);
        }
        return out;
    }

    public List<BackendRef> listDiscoverableBackends(String namespace, String labelKey, String labelValue) {
        List<BackendRef> out = new ArrayList<>();
        if (bearer.isBlank()) {
            return out;
        }
        try {
            String selector = URLEncoder.encode(labelKey + "=" + labelValue, StandardCharsets.UTF_8);
            JsonObject svcRoot = get("/api/v1/namespaces/" + namespace + "/services?labelSelector=" + selector);
            JsonObject epRoot = get("/api/v1/namespaces/" + namespace + "/endpoints?labelSelector=" + selector);
            if (svcRoot == null || epRoot == null) {
                return out;
            }

            Map<String, List<EndpointRef>> endpointsByService = new HashMap<>();
            JsonArray epItems = epRoot.getAsJsonArray("items");
            if (epItems != null) {
                for (JsonElement item : epItems) {
                    JsonObject ep = item.getAsJsonObject();
                    String name = str(ep, "metadata", "name");
                    List<EndpointRef> refs = new ArrayList<>();
                    JsonArray subsets = ep.getAsJsonArray("subsets");
                    if (subsets != null) {
                        for (JsonElement subsetE : subsets) {
                            JsonObject subset = subsetE.getAsJsonObject();
                            JsonArray addrs = subset.getAsJsonArray("addresses");
                            if (addrs != null) {
                                for (JsonElement addrE : addrs) {
                                    JsonObject addr = addrE.getAsJsonObject();
                                    String ip = str(addr, "ip");
                                    if (ip.isBlank()) {
                                        continue;
                                    }
                                    String podName = str(addr, "targetRef", "name");
                                    String podUid = str(addr, "targetRef", "uid");
                                    refs.add(new EndpointRef(ip, podName, podUid));
                                }
                            }
                        }
                    }
                    endpointsByService.put(name, refs);
                }
            }

            JsonArray svcItems = svcRoot.getAsJsonArray("items");
            if (svcItems == null) {
                return out;
            }
            for (JsonElement item : svcItems) {
                JsonObject svc = item.getAsJsonObject();
                String svcName = str(svc, "metadata", "name");
                String configuredName = svcName;
                JsonObject meta = svc.getAsJsonObject("metadata");
                if (meta != null) {
                    JsonObject ann = meta.getAsJsonObject("annotations");
                    if (ann != null && ann.has("mc.noobsters.net/velocity-server-name")) {
                        configuredName = ann.get("mc.noobsters.net/velocity-server-name").getAsString();
                    }
                }

                int port = 0;
                JsonArray ports = nested(svc, "spec", "ports");
                if (ports != null && !ports.isEmpty()) {
                    for (JsonElement pE : ports) {
                        JsonObject p = pE.getAsJsonObject();
                        String pName = str(p, "name");
                        if ("minecraft".equalsIgnoreCase(pName)) {
                            port = p.get("port").getAsInt();
                            break;
                        }
                        if (port == 0 && p.has("port")) {
                            port = p.get("port").getAsInt();
                        }
                    }
                }
                if (port == 0) {
                    continue;
                }

                List<EndpointRef> refs = endpointsByService.getOrDefault(svcName, List.of());
                for (EndpointRef ref : refs) {
                    String podPart = podHint(ref.podName(), ref.ip());
                    String uidPart = "";
                    if (!ref.podUid().isBlank()) {
                        String[] parts = ref.podUid().split("-");
                        String tail = parts.length == 0 ? ref.podUid() : parts[parts.length - 1];
                        if (tail.length() > 6) {
                            tail = tail.substring(0, 6);
                        }
                        uidPart = "-" + tail;
                    }
                    String backendName = configuredName + "-" + podPart + uidPart;
                    out.add(new BackendRef(backendName, ref.ip(), port, 1));
                }
            }
        } catch (Exception e) {
            logger.error("Failed to list discoverable backends", e);
        }
        return out;
    }

    public boolean restartWorkload(String namespace, String workloadName, String workloadKind, String timestamp) {
        if (bearer.isBlank()) {
            return false;
        }
        try {
            String resource = "deployments";
            if ("statefulset".equalsIgnoreCase(workloadKind) || "statefulsets".equalsIgnoreCase(workloadKind)) {
                resource = "statefulsets";
            }
            String path = "/apis/apps/v1/namespaces/" + namespace + "/" + resource + "/" + workloadName;
            String body = "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\""
                    + timestamp + "\"}}}}}";
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://kubernetes.default.svc" + path))
                    .timeout(Duration.ofSeconds(5))
                    .header("Authorization", "Bearer " + bearer)
                    .header("Content-Type", "application/strategic-merge-patch+json")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 200 && res.statusCode() < 300) {
                return true;
            }
            logger.error("Workload restart PATCH failed: {} {}", res.statusCode(), res.body());
            return false;
        } catch (Exception e) {
            logger.error("Failed to restart workload", e);
            return false;
        }
    }

    public String getConfigMapKey(String namespace, String configMapName, String key) {
        if (bearer.isBlank()) {
            return null;
        }
        try {
            JsonObject root = get("/api/v1/namespaces/" + namespace + "/configmaps/" + configMapName);
            if (root == null) {
                return null;
            }
            JsonObject data = root.getAsJsonObject("data");
            if (data == null || !data.has(key)) {
                return null;
            }
            return data.get(key).getAsString();
        } catch (Exception e) {
            logger.error("Failed to get configmap key {} from {}", key, configMapName, e);
            return null;
        }
    }

    public boolean patchConfigMapKey(String namespace, String configMapName, String key, String value) {
        if (bearer.isBlank()) {
            return false;
        }
        try {
            String escaped = value.replace("\\", "\\\\").replace("\"", "\\\"");
            String body = "{\"data\":{\"" + key + "\":\"" + escaped + "\"}}";
            String path = "/api/v1/namespaces/" + namespace + "/configmaps/" + configMapName;
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://kubernetes.default.svc" + path))
                    .timeout(Duration.ofSeconds(5))
                    .header("Authorization", "Bearer " + bearer)
                    .header("Content-Type", "application/merge-patch+json")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 200 && res.statusCode() < 300) {
                return true;
            }
            logger.error("ConfigMap PATCH failed: {} {}", res.statusCode(), res.body());
            return false;
        } catch (Exception e) {
            logger.error("Failed to patch configmap key {} on {}", key, configMapName, e);
            return false;
        }
    }

    private JsonObject get(String path) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create("https://kubernetes.default.svc" + path))
                .timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + bearer)
                .GET()
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            logger.error("Kubernetes API GET failed: {} {}", res.statusCode(), res.body());
            return null;
        }
        return JsonParser.parseString(res.body()).getAsJsonObject();
    }

    private boolean isPodReady(JsonObject pod) {
        JsonArray conditions = nested(pod, "status", "conditions");
        if (conditions == null) {
            return false;
        }
        for (JsonElement c : conditions) {
            JsonObject cond = c.getAsJsonObject();
            String type = str(cond, "type");
            String status = str(cond, "status");
            if ("Ready".equals(type)) {
                return "True".equals(status);
            }
        }
        return false;
    }

    private static String str(JsonObject obj, String... path) {
        JsonElement e = obj;
        for (String p : path) {
            if (e == null || !e.isJsonObject()) {
                return "";
            }
            e = e.getAsJsonObject().get(p);
        }
        if (e == null || e.isJsonNull()) {
            return "";
        }
        return e.getAsString();
    }

    private static JsonArray nested(JsonObject obj, String parent, String child) {
        JsonElement p = obj.get(parent);
        if (p == null || !p.isJsonObject()) {
            return null;
        }
        JsonElement c = p.getAsJsonObject().get(child);
        if (c == null || !c.isJsonArray()) {
            return null;
        }
        return c.getAsJsonArray();
    }

    private static String podHint(String podName, String ip) {
        if (podName == null || podName.isBlank()) {
            return ip.replace('.', '-');
        }
        Matcher ordinal = Pattern.compile(".*-(\\d+)$").matcher(podName);
        if (ordinal.matches()) {
            return ordinal.group(1);
        }
        Matcher deploySuffix = Pattern.compile(".*-([a-z0-9]{5})$").matcher(podName);
        if (deploySuffix.matches()) {
            return deploySuffix.group(1);
        }
        int idx = podName.lastIndexOf('-');
        if (idx > 0 && idx < podName.length() - 1) {
            return podName.substring(idx + 1);
        }
        return podName;
    }

    public record PodRef(String name, String podIp, boolean ready) {}
    public record BackendRef(String name, String host, int port, int readyEndpoints) {}
    private record EndpointRef(String ip, String podName, String podUid) {}
}
