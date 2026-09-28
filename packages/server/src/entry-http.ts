import { realpathSync } from "node:fs";
import { createLocalServices, getAppConfigDir, setDataBaseDir } from "@zcode/services/node";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

/**
 * Разворачиваем короткие пути 8.3 в env в полные ДО чтения любого пути. launcher
 * даёт 8.3 (`C:\Users\USERNAME~1\...`), чтобы обойти не-ASCII в .cmd, но
 * рекурсивный fs.watch по 8.3-пути роняет процесс нативным assert libuv на Windows
 * (fs-event.c:72). Нормализуем здесь — тогда и сервер, и наследующий env дочерний
 * агент, и все производные пути (data dir, sessions, workspace-config) видят полный путь.
 */
function normalizeEnvPath(name: string, isList = false): void {
  const raw = process.env[name];
  if (!raw) return;
  const expand = (p: string): string => {
    const trimmed = p.trim();
    if (!trimmed) return trimmed;
    try {
      return realpathSync.native(trimmed);
    } catch {
      return trimmed;
    }
  };
  process.env[name] = isList
    ? raw
        .split(";")
        .map(expand)
        .filter((p) => p.length > 0)
        .join(";")
    : expand(raw);
}

async function main(): Promise<void> {
  normalizeEnvPath("ZCODE_DATA_BASE_DIR");
  normalizeEnvPath("ZCODE_SERVER_WORKSPACE", true);
  normalizeEnvPath("ZCODE_WEB_STATIC_ROOT");
  // paths.ts кэширует ZCODE_DATA_BASE_DIR ещё на import (до main), поэтому мутации
  // process.env для СВОЕГО процесса мало — форсим полный путь через setDataBaseDir
  // (высший приоритет в getDataBaseDir). Без этого рекурсивный fs.watch по 8.3-пути
  // data-dir роняет сервер нативным assert libuv. Мутация env выше нужна дочернему агенту.
  const dataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim();
  if (dataBaseDir) {
    setDataBaseDir(dataBaseDir);
  }
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["ZCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["ZCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[zcode-server:http] startup failed", error);
  process.exitCode = 1;
});
