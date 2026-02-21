package mc.noobsters.lobbyinspector;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class LobbyInspectorPlugin extends JavaPlugin implements Listener {
    private static final String PERM_USE = "lobbyinspector.use";
    private static final String TITLE_PREFIX = ChatColor.DARK_AQUA + "Inspect: ";
    private static final int UPDATE_TICKS = 10;

    private final Map<UUID, Session> sessions = new HashMap<>();

    @Override
    public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
        getLogger().info("LobbyInspector enabled");
    }

    @Override
    public void onDisable() {
        for (Session s : sessions.values()) {
            Bukkit.getScheduler().cancelTask(s.taskId());
        }
        sessions.clear();
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onSpectatorRightClick(PlayerInteractEntityEvent event) {
        Player viewer = event.getPlayer();
        if (viewer.getGameMode() != GameMode.SPECTATOR) {
            return;
        }
        if (!viewer.hasPermission(PERM_USE)) {
            return;
        }

        Entity clicked = event.getRightClicked();
        if (!(clicked instanceof Player target)) {
            return;
        }

        if (viewer.getUniqueId().equals(target.getUniqueId())) {
            viewer.sendMessage(ChatColor.RED + "You cannot inspect yourself.");
            return;
        }

        event.setCancelled(true);
        openInspect(viewer, target);
    }

    @EventHandler
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player viewer)) {
            return;
        }
        Session session = sessions.get(viewer.getUniqueId());
        if (session == null) {
            return;
        }
        if (!(event.getView().getTopInventory().getHolder() instanceof InspectorHolder)) {
            return;
        }
        event.setCancelled(true);
    }

    @EventHandler
    public void onInventoryClose(InventoryCloseEvent event) {
        if (!(event.getPlayer() instanceof Player viewer)) {
            return;
        }
        Session session = sessions.get(viewer.getUniqueId());
        if (session == null) {
            return;
        }
        if (!(event.getInventory().getHolder() instanceof InspectorHolder)) {
            return;
        }
        stopSession(viewer.getUniqueId());
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        stopSession(event.getPlayer().getUniqueId());
    }

    private void openInspect(Player viewer, Player target) {
        stopSession(viewer.getUniqueId());

        Inventory inv = Bukkit.createInventory(new InspectorHolder(), 54, TITLE_PREFIX + target.getName());
        Session session = new Session(target.getUniqueId(), inv, -1);
        sessions.put(viewer.getUniqueId(), session);

        int taskId = Bukkit.getScheduler().scheduleSyncRepeatingTask(this, () -> tickSession(viewer.getUniqueId()), 0L, UPDATE_TICKS);
        sessions.put(viewer.getUniqueId(), new Session(target.getUniqueId(), inv, taskId));

        viewer.openInventory(inv);
    }

    private void tickSession(UUID viewerId) {
        Session session = sessions.get(viewerId);
        if (session == null) {
            return;
        }

        Player viewer = Bukkit.getPlayer(viewerId);
        if (viewer == null || !viewer.isOnline()) {
            stopSession(viewerId);
            return;
        }

        Player target = Bukkit.getPlayer(session.targetId());
        if (target == null || !target.isOnline()) {
            viewer.closeInventory();
            viewer.sendMessage(ChatColor.YELLOW + "Target went offline.");
            stopSession(viewerId);
            return;
        }

        if (!(viewer.getOpenInventory().getTopInventory().getHolder() instanceof InspectorHolder)) {
            stopSession(viewerId);
            return;
        }

        fillInventory(session.inventory(), target);
    }

    private void fillInventory(Inventory out, Player target) {
        out.clear();

        out.setItem(0, statItem(Material.RED_DYE, ChatColor.RED + "Health",
                String.format("%.1f / %.1f", target.getHealth(), maxHealth(target))));
        out.setItem(1, statItem(Material.COOKED_BEEF, ChatColor.GOLD + "Hunger",
                target.getFoodLevel() + " / 20",
                "Saturation: " + String.format("%.1f", target.getSaturation())));
        out.setItem(2, statItem(Material.IRON_CHESTPLATE, ChatColor.AQUA + "Armor",
                String.format("%.1f", target.getAttribute(Attribute.ARMOR).getValue())));
        out.setItem(3, statItem(Material.EXPERIENCE_BOTTLE, ChatColor.GREEN + "Experience",
                "Level: " + target.getLevel(),
                "XP bar: " + String.format("%.2f", target.getExp())));
        out.setItem(4, statItem(Material.COMPASS, ChatColor.YELLOW + "Location",
                shortLocation(target.getLocation()),
                "World: " + target.getWorld().getName()));
        out.setItem(5, statItem(Material.CLOCK, ChatColor.LIGHT_PURPLE + "Status",
                "Gamemode: " + target.getGameMode().name(),
                "Effects: " + effectCount(target)));

        PlayerInventory inv = target.getInventory();
        out.setItem(9, cloneOrAir(inv.getHelmet()));
        out.setItem(10, cloneOrAir(inv.getChestplate()));
        out.setItem(11, cloneOrAir(inv.getLeggings()));
        out.setItem(12, cloneOrAir(inv.getBoots()));
        out.setItem(13, cloneOrAir(inv.getItemInOffHand()));
        out.setItem(14, cloneOrAir(inv.getItemInMainHand()));

        ItemStack[] storage = inv.getStorageContents();
        for (int i = 9; i < 36 && i < storage.length; i++) {
            out.setItem(18 + (i - 9), cloneOrAir(storage[i]));
        }
        for (int i = 0; i < 9 && i < storage.length; i++) {
            out.setItem(45 + i, cloneOrAir(storage[i]));
        }
    }

    private void stopSession(UUID viewerId) {
        Session old = sessions.remove(viewerId);
        if (old != null && old.taskId() > 0) {
            Bukkit.getScheduler().cancelTask(old.taskId());
        }
    }

    private static ItemStack cloneOrAir(ItemStack item) {
        if (item == null || item.getType() == Material.AIR) {
            return new ItemStack(Material.AIR);
        }
        return item.clone();
    }

    private static ItemStack statItem(Material material, String name, String... lines) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            meta.setDisplayName(name);
            List<String> lore = new ArrayList<>();
            for (String line : lines) {
                lore.add(ChatColor.GRAY + line);
            }
            meta.setLore(lore);
            meta.addItemFlags(ItemFlag.HIDE_ATTRIBUTES);
            item.setItemMeta(meta);
        }
        return item;
    }

    private static String shortLocation(Location loc) {
        return String.format("x=%d y=%d z=%d", loc.getBlockX(), loc.getBlockY(), loc.getBlockZ());
    }

    private static String effectCount(Player player) {
        int count = 0;
        for (PotionEffect ignored : player.getActivePotionEffects()) {
            count++;
        }
        return Integer.toString(count);
    }

    private static double maxHealth(Player player) {
        if (player.getAttribute(Attribute.MAX_HEALTH) == null) {
            return 20.0;
        }
        return player.getAttribute(Attribute.MAX_HEALTH).getValue();
    }

    private record Session(UUID targetId, Inventory inventory, int taskId) {}

    private static final class InspectorHolder implements InventoryHolder {
        @Override
        public Inventory getInventory() {
            return null;
        }
    }
}
