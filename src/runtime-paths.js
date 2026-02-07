import { homedir } from "os";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function expandHomeDir(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function resolvePath(input, fallback) {
  const raw = (input || fallback || "").trim();
  if (!raw) return appRoot;
  const expanded = expandHomeDir(raw);
  return isAbsolute(expanded) ? expanded : resolve(appRoot, expanded);
}

function parsePathList(input) {
  if (!input) return [];
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getDataDir(config = null) {
  if (config?.paths?.dataDir) return config.paths.dataDir;
  return resolvePath(process.env.DATA_DIR, "./data");
}

export function getPluginDirs(config = null) {
  if (Array.isArray(config?.paths?.pluginDirs) && config.paths.pluginDirs.length > 0) {
    return config.paths.pluginDirs;
  }

  const listed = parsePathList(process.env.PLUGIN_DIRS);
  if (listed.length > 0) {
    return listed.map((entry) => resolvePath(entry));
  }

  return [resolvePath(process.env.PLUGIN_DIR, "./plugins")];
}
