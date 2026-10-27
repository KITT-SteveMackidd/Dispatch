const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Backend dependencies, emulator exports and local credentials are not mobile
// source. Excluding them also avoids Windows file-handle exhaustion during QA.
const escapedRoot = __dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList) ? existingBlockList : existingBlockList ? [existingBlockList] : []),
  new RegExp(`^${escapedRoot}[\\\\/](?:functions|\\.local-data|\\.git)(?:[\\\\/]|$)`),
];
if (process.env.DISPATCH_LOCAL_CHAT_SAFETY_PREVIEW === 'true') config.maxWorkers = 2;

module.exports = config;
