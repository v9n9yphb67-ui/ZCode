import {
  getCapturedZCodeCuaBrokerCredentials,
  ZCODE_CUA_OFFICIAL_PLUGIN_ID,
  ZCODE_CUA_PLUGIN_AUTHORITY_ENV_KEY,
  ZCODE_PLUGIN_ID_ENV_KEY,
} from "@zcode/shared";
import { toMcpToolName } from "../../mcp/name.js";
import { registerMcpTools, traceContextToLogContext } from "../deps.js";
import type { McpConnectionSnapshot, McpServerConfig, TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

const MCP_SESSION_OAUTH_AUTHORIZATION_TIMEOUT_MS = 15_000;

/**
 * 只有同时携带 resolver 注入的官方 plugin id 和本进程私有 authority 的 server 才能共享
 * Computer Use 项目授权。server 名、tool 名和 manifest env 都可被第三方仿造，不能单独作为信任依据。
 */
export function computeOfficialCuaServerNames(
  servers: Record<string, McpServerConfig>,
  trustedServerNames: ReadonlySet<string>,
): Set<string> {
  const expectedAuthority = getCapturedZCodeCuaBrokerCredentials().pluginAuthority;
  const names = new Set<string>();
  if (!expectedAuthority) return names;

  for (const [name, config] of Object.entries(servers)) {
    if (!trustedServerNames.has(name)) continue;
    if (config.type !== "stdio") continue;
    if (
      config.env?.[ZCODE_PLUGIN_ID_ENV_KEY]?.trim().toLowerCase() !==
        ZCODE_CUA_OFFICIAL_PLUGIN_ID ||
      config.env?.[ZCODE_CUA_PLUGIN_AUTHORITY_ENV_KEY]?.trim() !== expectedAuthority
    ) {
      continue;
    }
    names.add(name);
  }
  return names;
}

export function startMcpStartup(
  this: AgentRuntimeInternal,
  traceContext: TraceContext,
): Promise<McpConnectionSnapshot> | undefined {
  if (this.mcpInitialized) return this.mcpStartupPromise;
  this.mcpInitialized = true;

  if (!this.mcpPort || this.config.mcp?.enabled === false) {
    this.mcpToolsRegistered = true;
    return undefined;
  }

  const servers = this.config.mcp?.servers ?? {};
  if (Object.keys(servers).length === 0) {
    const startup = Promise.all([this.mcpPort.status(), this.mcpPort.listTools()])
      .then(([statuses, tools]) => ({ statuses, tools }))
      .catch((error) => {
        this.logger?.warn("MCP existing tool discovery failed", {
          ...traceContextToLogContext(traceContext),
          error: error instanceof Error ? error.message : String(error),
          event: "mcp.existing_tools.failed",
          module: "core.runtime",
          status: "failed",
        });
        return { statuses: {}, tools: [] };
      });
    this.mcpStartupPromise = this.trackResidencyBlockingWork(startup);
    return this.mcpStartupPromise;
  }

  const startedAt = Date.now();
  const startup = this.mcpPort
    .connectConfiguredServers(servers, {
      // authorization_code MCP 无人完成浏览器授权时，session 启动过去会等默认 5 分钟，
      // 导致模型请求迟迟不发出；session 只等 15s，授权入口由设置页 mcp/list 展示。
      oauthAuthorizationTimeoutMs: MCP_SESSION_OAUTH_AUTHORIZATION_TIMEOUT_MS,
      trace: traceContext,
      workingDirectory: this.workingDirectory,
      workspaceIdentity: this.config.workspaceIdentity?.toString(),
    })
    .then((snapshot) => {
      const statusCounts = Object.values(snapshot.statuses).reduce<Record<string, number>>(
        (counts, status) => {
          counts[status.status] = (counts[status.status] ?? 0) + 1;
          return counts;
        },
        {},
      );
      this.logger?.info("MCP startup completed", {
        ...traceContextToLogContext(traceContext),
        durationMs: Date.now() - startedAt,
        event: "mcp.startup.completed",
        module: "core.runtime",
        serverCount: Object.keys(servers).length,
        status: "completed",
        statusCounts,
        toolCount: snapshot.tools.length,
      });
      return snapshot;
    })
    .catch((error) => {
      this.logger?.warn("MCP startup failed", {
        ...traceContextToLogContext(traceContext),
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        event: "mcp.startup.failed",
        module: "core.runtime",
        status: "failed",
      });
      return { statuses: {}, tools: [] };
    });
  this.mcpStartupPromise = this.trackResidencyBlockingWork(startup);
  this.logger?.debug("MCP startup scheduled", {
    ...traceContextToLogContext(traceContext),
    event: "mcp.startup.scheduled",
    module: "core.runtime",
    serverCount: Object.keys(servers).length,
    status: "started",
  });
  return this.mcpStartupPromise;
}

export async function initializeMcp(
  this: AgentRuntimeInternal,
  traceContext: TraceContext,
): Promise<void> {
  // mcpToolsRegistered — одноразовый флаг первой (стартовой) инициализации.
  // connecting — это «серверы ещё подключаются», а не «их нет»: стартовый snapshot может
  // прийти с tools=[] при живых connecting, и тогда флага-без-ретрая было достаточно, чтобы
  // сессия осталась без MCP-инструментов навсегда. Поэтому: стартовая инициализация ждёт
  // pending-подключения (ретрай ниже), а поздние вызовы удобного случая (resume/turn после
  // долгой паузы) добирают инструменты, которые подъехали уже после старта.
  const isFirstInitialization = !this.mcpToolsRegistered;

  const startup = this.startMcpStartup(traceContext);
  const mcpPort = this.mcpPort;
  if (!startup || !mcpPort) {
    this.mcpToolsRegistered = true;
    return;
  }
  const serverCount = Object.keys(this.config.mcp?.servers ?? {}).length;
  const hasPendingConnections = (snapshot: McpConnectionSnapshot): boolean =>
    Object.values(snapshot.statuses).some((status) => status?.status === "connecting");

  // Поздний добор: серверы могли подключиться уже после стартового snapshot.
  // Читаем актуальный список инструментов из mcpPort.listTools(); если появились инструменты,
  // которых ещё нет в registry — дорегистрируем их и инвалидируем кэш тулов модели.
  const collectLateArrivals = async (): Promise<number> => {
    const tools = await mcpPort.listTools().catch(() => []);
    if (tools.length === 0) return 0;
    const hasUnregistered = tools.some((t) => {
      const toolName = toMcpToolName(t);
      return !this.registry.has(toolName);
    });
    if (!hasUnregistered) return 0;

    const registered = registerMcpTools(this.registry, mcpPort, tools, {
      allowedTools: this.config.toolAllowlist,
      disallowedTools: this.config.toolDisallowlist,
      officialCuaServerNames: computeOfficialCuaServerNames(
        this.config.mcp?.servers ?? {},
        new Set(this.config.mcp?.trustedOfficialCuaServerNames ?? []),
      ),
    });
    if (registered.length > 0) {
      this.invalidateToolCache();
      this.logger?.info("MCP late tools registered", {
        ...traceContextToLogContext(traceContext),
        event: "mcp.tools.registered_late",
        module: "core.runtime",
        registeredToolCount: registered.length,
        serverCount,
        status: "completed",
      });
    }
    return registered.length;
  };

  if (!isFirstInitialization) {
    await collectLateArrivals().catch(() => 0);
    return;
  }

  try {
    let snapshot = await startup;
    if (hasPendingConnections(snapshot)) {
      const pendingRetry = mcpPort
        .connectConfiguredServers(this.config.mcp?.servers ?? {}, {
          // OAuth-ожидание здесь нельзя наследовать от сессии: браузерная авторизация
          // показывается из настроек (5 мин бюджет), а модели нужен только готовый итог.
          oauthAuthorizationTimeoutMs: MCP_SESSION_OAUTH_AUTHORIZATION_TIMEOUT_MS,
          trace: traceContext,
          workingDirectory: this.workingDirectory,
          workspaceIdentity: this.config.workspaceIdentity?.toString(),
        })
        .catch((error) => {
          this.logger?.warn("MCP pending connections rewait failed", {
            ...traceContextToLogContext(traceContext),
            error: error instanceof Error ? error.message : String(error),
            event: "mcp.pending_rewait.failed",
            module: "core.runtime",
            status: "failed",
          });
          return null;
        });
      const retried = pendingRetry ? await this.trackResidencyBlockingWork(pendingRetry) : null;
      if (retried && retried.tools.length > 0) {
        snapshot = retried;
      }
    }
    const currentTools = await mcpPort.listTools().catch(() => []);
    const toolsToRegister = currentTools.length > 0 ? currentTools : snapshot.tools;
    const registered = registerMcpTools(this.registry, mcpPort, toolsToRegister, {
      allowedTools: this.config.toolAllowlist,
      disallowedTools: this.config.toolDisallowlist,
      officialCuaServerNames: computeOfficialCuaServerNames(
        this.config.mcp?.servers ?? {},
        new Set(this.config.mcp?.trustedOfficialCuaServerNames ?? []),
      ),
    });
    if (registered.length > 0) {
      this.invalidateToolCache();
    }
    this.logger?.info("MCP tools registered", {
      ...traceContextToLogContext(traceContext),
      event: "mcp.tools.registered",
      module: "core.runtime",
      registeredToolCount: registered.length,
      serverCount,
      status: "completed",
    });
  } catch (error) {
    this.mcpToolsRegistered = true;
    this.logger?.warn("MCP initialization failed", {
      ...traceContextToLogContext(traceContext),
      error: error instanceof Error ? error.message : String(error),
      event: "mcp.initialization.failed",
      module: "core.runtime",
      status: "failed",
    });
  }
  this.mcpToolsRegistered = true;
}
