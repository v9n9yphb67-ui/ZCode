import { useEffect } from "react";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { setMcpStoreDirectoryService, useMcpStore } from "@/store/mcpStore.js";

export function useEnsureWorkspaceMcpLoaded(
  workspaceAbsPath: string,
  workspaceIdentity: string | undefined,
  rpcReady: boolean,
) {
  // Раньше брали mcpSyncService из useServices() (глобальный ServiceProvider). На вебе
  // он не даёт рабочий mcpSyncService → loadMcpFromUserDirectory RPC не вызывался ни разу
  // (в серверном логе 0 вызовов), список MCP оставался пустым и агент не видел серверы.
  // Берём workspace-scoped services — тот же аксессор, что использует McpSettingsSection
  // (его status-RPC работает на вебе).
  const services = useWorkspaceServices(workspaceAbsPath, undefined, workspaceIdentity);

  useEffect(() => {
    if (!rpcReady) {
      return;
    }
    setMcpStoreDirectoryService(services.mcpSyncService);
    return () => {
      setMcpStoreDirectoryService(null);
    };
  }, [rpcReady, services.mcpSyncService]);

  useEffect(() => {
    if (!rpcReady) {
      // remote tab 恢复时 App 会先拿到断连代理；若立即
      // 读取 MCP 目录，只是在 store 内吞掉了断连错误，并未遵守 workspace
      // RPC 隔离边界。等待真实 services 注册后再执行，不缓存也不跨 transport 重放。
      return;
    }
    void useMcpStore
      .getState()
      .ensureLoadedForWorkspace(workspaceAbsPath, services.mcpSyncService, workspaceIdentity);
  }, [rpcReady, services.mcpSyncService, workspaceAbsPath, workspaceIdentity]);
}
