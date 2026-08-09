// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

/**
 * Metro configuration for the BANHAO monorepo.
 *
 * Two things Metro does not do on its own here:
 *
 *  1. Watch the workspace root, so edits in packages/* trigger a rebuild.
 *  2. Resolve from the root node_modules. pnpm keeps packages in an isolated
 *     .pnpm store and only symlinks direct dependencies, so transitive ones
 *     (notably @babel/runtime helpers injected by the Babel transform) are not
 *     reachable from the app folder alone.
 *
 * `disableHierarchicalLookup` is deliberately left off: pnpm relies on
 * hierarchical resolution to reach symlinked workspace packages.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Workspace packages ship TypeScript source rather than build output, so Metro
// must follow the symlinks into packages/*.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
