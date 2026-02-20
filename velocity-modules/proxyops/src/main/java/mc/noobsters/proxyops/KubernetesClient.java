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

    public boolean restartDeployment(String namespace, String deployment, String timestamp) {
        if (bearer.isBlank()) {
            return false;
        }
        try {
            String path = "/apis/apps/v1/namespaces/" + namespace + "/deployments/" + deployment;
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
            logger.error("Deployment restart PATCH failed: {} {}", res.statusCode(), res.body());
            return false;
        } catch (Exception e) {
            logger.error("Failed to restart deployment", e);
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

    public record PodRef(String name, String podIp, boolean ready) {}
}
