import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getDataDir } from "./runtime-paths.js";

const SETTINGS_FILE = "plugin-settings.json";

function getSettingsPath(config) {
  return join(getDataDir(config), SETTINGS_FILE);
}

function loadSettings(config) {
  const file = getSettingsPath(config);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(settings, config) {
  const file = getSettingsPath(config);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
}

/**
 * Check if a plugin is enabled for a given user.
 * Defaults to enabled unless the admin has listed the plugin in defaultDisabledPlugins,
 * or the user has explicitly disabled it.
 */
export function isPluginEnabled(pluginName, userId, config) {
  const defaultDisabled = config?.plugins?.defaultDisabledPlugins || [];
  const settings = loadSettings(config);
  const userSettings = settings[String(userId)] || {};

  if (Object.prototype.hasOwnProperty.call(userSettings, pluginName)) {
    return userSettings[pluginName] !== false;
  }

  return !defaultDisabled.includes(pluginName);
}

/**
 * Set plugin enabled/disabled state for a user.
 */
export function setPluginEnabled(pluginName, userId, enabled, config) {
  const settings = loadSettings(config);
  const key = String(userId);
  if (!settings[key]) settings[key] = {};
  settings[key][pluginName] = enabled;
  saveSettings(settings, config);
}

/**
 * Get per-user plugin overrides for a user.
 * Returns { [pluginName]: boolean }
 */
export function getUserPluginSettings(userId, config) {
  const settings = loadSettings(config);
  return settings[String(userId)] || {};
}
