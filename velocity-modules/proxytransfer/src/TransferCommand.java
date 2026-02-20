package com.protoxon.proxyTransfer;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.velocitypowered.api.command.BrigadierCommand;
import com.velocitypowered.api.command.CommandManager;
import com.velocitypowered.api.command.CommandMeta;
import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.proxy.Player;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Optional;

import static com.protoxon.proxyTransfer.ProxyTransfer.logger;
import static com.protoxon.proxyTransfer.ProxyTransfer.proxy;

public class TransferCommand {
    public static void register() {
        CommandManager commandManager = proxy.getCommandManager();
        LiteralArgumentBuilder<CommandSource> root = LiteralArgumentBuilder.literal("transfer");

        root.executes(TransferCommand::handleRootCommand);

        root.then(transfer());
        BrigadierCommand brigadierCommand = new BrigadierCommand(root);
        CommandMeta commandMeta = commandManager.metaBuilder("transfer")
                .plugin(ProxyTransfer.plugin)
                .build();
        commandManager.register(commandMeta, brigadierCommand);

        LiteralArgumentBuilder<CommandSource> drainRoot = LiteralArgumentBuilder.literal("draintransfer");
        drainRoot.executes(TransferCommand::handleDrainRootCommand);
        drainRoot.then(drainTransfer());
        BrigadierCommand drainCommand = new BrigadierCommand(drainRoot);
        CommandMeta drainMeta = commandManager.metaBuilder("draintransfer")
                .plugin(ProxyTransfer.plugin)
                .build();
        commandManager.register(drainMeta, drainCommand);
    }

    private static int handleRootCommand(CommandContext<CommandSource> context) {
        CommandSource source = context.getSource();
        source.sendMessage(Component.text("Invalid Command Usage!"));
        if(source.hasPermission("proxytransfer.others")) {
            source.sendMessage(Component.text("/transfer <host> [player|local|all]"));
            return 0;
        }
        source.sendMessage(Component.text("/transfer <host>"));
        return 0;
    }

    private static int handleDrainRootCommand(CommandContext<CommandSource> context) {
        CommandSource source = context.getSource();
        source.sendMessage(Component.text("Usage: /draintransfer <host:port> <all|local|player> [seconds]"));
        return 0;
    }

    public static RequiredArgumentBuilder<CommandSource, String> transfer() {
        return RequiredArgumentBuilder.<CommandSource, String>argument("target", StringArgumentType.greedyString())
                .suggests((context, builder) -> {
                    String input = builder.getRemaining().toLowerCase();
                    // Show suggestions only if the user is typing the second argument
                    if (input.contains(" ")) {
                        builder.suggest("all");
                        builder.suggest("local");
                        proxy.getAllPlayers().forEach(player -> builder.suggest(player.getUsername()));
                    }
                    return builder.buildFuture();
                })
                .executes(context -> {
                    CommandSource source = context.getSource();

                    String input = StringArgumentType.getString(context, "target").trim();
                    String[] parts = input.split("\\s+"); // Split by space(s)

                    if (parts.length == 0) {
                        source.sendMessage(Component.text("Invalid usage. Please provide a host.", NamedTextColor.RED));
                        return 0;
                    }

                    String hostPort = parts[0];
                    String[] hostParts = hostPort.split(":", 2);
                    String host = hostParts[0];
                    int port = 25565;
                    if (hostParts.length > 1) {
                        try {
                            port = Integer.parseInt(hostParts[1]);
                        } catch (NumberFormatException e) {
                            source.sendMessage(Component.text("Error: Invalid port.", NamedTextColor.RED));
                            return 0;
                        }
                    }

                    // Handle optional second argument
                    String playerContext = (parts.length > 1) ? parts[1] : null;

                    if (playerContext == null) {
                        if (!(source instanceof Player executor)) {
                            source.sendMessage(Component.text("Console usage: /transfer <host:port> all | <player>", NamedTextColor.RED));
                            return 0;
                        }
                        Transfer.transferPlayer(executor, host, port);
                        return 1;
                    }

                    if (!source.hasPermission("proxytransfer.others")) {
                        source.sendMessage(Component.text("You don't have permission to transfer others. You must have the \"proxytransfer.others\" permission.", NamedTextColor.RED));
                        return 0;
                    }

                    switch (playerContext.toLowerCase()) {
                        case "all":
                            for (Player p : proxy.getAllPlayers()) {
                                Transfer.transferPlayer(p, host, port);
                            }
                            return 1;

                        case "local":
                            for (Player p : getPlayersOnSameServer(source)) {
                                Transfer.transferPlayer(p, host, port);
                            }
                            return 1;

                        default:
                            Player target = getPlayer(playerContext);
                            if (target == null) {
                                source.sendMessage(Component.text("Player " + playerContext + " not found.", NamedTextColor.RED));
                                return 0;
                            }
                            Transfer.transferPlayer(target, host, port);
                            return 1;
                    }
                });
    }

    public static RequiredArgumentBuilder<CommandSource, String> drainTransfer() {
        return RequiredArgumentBuilder.<CommandSource, String>argument("target", StringArgumentType.greedyString())
                .suggests((context, builder) -> {
                    String input = builder.getRemaining().toLowerCase();
                    if (input.contains(" ")) {
                        builder.suggest("all 3");
                        builder.suggest("local 3");
                        proxy.getAllPlayers().forEach(player -> builder.suggest(player.getUsername() + " 3"));
                    }
                    return builder.buildFuture();
                })
                .executes(context -> {
                    CommandSource source = context.getSource();
                    String input = StringArgumentType.getString(context, "target").trim();
                    String[] parts = input.split("\\s+");
                    if (parts.length < 2) {
                        source.sendMessage(Component.text("Usage: /draintransfer <host:port> <all|local|player> [seconds]", NamedTextColor.RED));
                        return 0;
                    }

                    String hostPort = parts[0];
                    String[] hostParts = hostPort.split(":", 2);
                    String host = hostParts[0];
                    int port = 25565;
                    if (hostParts.length > 1) {
                        try {
                            port = Integer.parseInt(hostParts[1]);
                        } catch (NumberFormatException e) {
                            source.sendMessage(Component.text("Error: Invalid port.", NamedTextColor.RED));
                            return 0;
                        }
                    }

                    String playerContext = parts[1];
                    int countdownSeconds = 3;
                    if (parts.length > 2) {
                        try {
                            countdownSeconds = Math.max(1, Integer.parseInt(parts[2]));
                        } catch (NumberFormatException e) {
                            source.sendMessage(Component.text("Error: Invalid countdown seconds.", NamedTextColor.RED));
                            return 0;
                        }
                    }

                    if (!source.hasPermission("proxytransfer.others")) {
                        source.sendMessage(Component.text("You don't have permission to transfer others. You must have the \"proxytransfer.others\" permission.", NamedTextColor.RED));
                        return 0;
                    }

                    Collection<Player> targets;
                    switch (playerContext.toLowerCase()) {
                        case "all":
                            targets = new ArrayList<>(proxy.getAllPlayers());
                            break;
                        case "local":
                            targets = new ArrayList<>(getPlayersOnSameServer(source));
                            break;
                        default:
                            Player target = getPlayer(playerContext);
                            if (target == null) {
                                source.sendMessage(Component.text("Player " + playerContext + " not found.", NamedTextColor.RED));
                                return 0;
                            }
                            targets = Collections.singletonList(target);
                            break;
                    }

                    if (targets.isEmpty()) {
                        source.sendMessage(Component.text("No players to transfer.", NamedTextColor.YELLOW));
                        return 1;
                    }

                    scheduleDrainTransfer(targets, host, port, countdownSeconds);
                    source.sendMessage(Component.text("Starting drain transfer for " + targets.size() + " player(s).", NamedTextColor.GREEN));
                    return 1;
                });
    }

    private static void scheduleDrainTransfer(Collection<Player> players, String host, int port, int countdownSeconds) {
        for (int remaining = countdownSeconds; remaining >= 1; remaining--) {
            int delaySeconds = countdownSeconds - remaining;
            int snapshotRemaining = remaining;
            proxy.getScheduler().buildTask(ProxyTransfer.plugin, () -> {
                for (Player player : players) {
                    player.showTitle(Title.title(
                            Component.text("Proxy update", NamedTextColor.GOLD),
                            Component.text("Transferring you in " + snapshotRemaining + "...", NamedTextColor.YELLOW),
                            Title.Times.times(Duration.ZERO, Duration.ofSeconds(1), Duration.ofMillis(250))
                    ));
                }
            }).delay(Duration.ofSeconds(delaySeconds)).schedule();
        }

        proxy.getScheduler().buildTask(ProxyTransfer.plugin, () -> {
            for (Player player : players) {
                Transfer.transferPlayer(player, host, port);
            }
        }).delay(Duration.ofSeconds(countdownSeconds)).schedule();
    }
    public static Player getPlayer(String username) {
        Optional<Player> player = proxy.getPlayer(username);
        return player.orElse(null);
    }

    public static Collection<Player> getPlayersOnSameServer(CommandSource source) {
        if (!(source instanceof Player player)) {
            logger.error("You must be a player to use the local argument!");
            return Collections.emptyList();
        }
        return player.getCurrentServer()
                .map(serverConnection -> serverConnection.getServer().getPlayersConnected())
                .orElse(Collections.emptyList());
    }
}
