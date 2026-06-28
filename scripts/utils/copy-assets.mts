import path from 'node:path';

import { watch, FSWatcher } from 'chokidar';
import fs from 'fs-extra';

import { buildDir, relativeToRoot, srcDir } from './paths.mts';

type CleanupFunction = () => Promise<void>;

const IGNORE_PATTERNS = [/\.(json|ts|tsx)$/, /\.DS_Store$/, /__tests__/];

function srcPathToBuildPath(srcPath: string): string {
  return path.join(buildDir, path.relative(srcDir, srcPath));
}

function createWatcher(persistent: boolean): {
  close: () => Promise<void>;
  ready: Promise<void>;
  watcher: FSWatcher;
} {
  const watcher = watch(srcDir, { ignored: IGNORE_PATTERNS, persistent });

  watcher
    .on('add', (srcPath) => {
      const destPath = srcPathToBuildPath(srcPath);
      console.log(`Copying asset: ${relativeToRoot(srcPath)}`);
      fs.copySync(srcPath, destPath);
    })
    .on('error', (error) => {
      console.error('Asset watcher error:', error);
    });

  const close = () =>
    watcher.close().catch((error) => {
      console.warn('Error closing asset watcher:', error);
    });

  const ready = new Promise<void>((resolve, reject) => {
    watcher.on('ready', resolve).on('error', reject);
  });

  return { close, ready, watcher };
}

export async function copyAssets(): Promise<void> {
  // One-off copy: walk srcDir and copy directly. We deliberately avoid chokidar
  // here — a non-persistent watcher still opens an fs.watch handle per directory
  // just to enumerate once, which blows the macOS EMFILE limit (no fsevents
  // prebuilt → fs.watch fallback). fs-extra's recursive copy needs no watchers.
  await fs.copy(srcDir, buildDir, {
    filter: (srcPath) =>
      !IGNORE_PATTERNS.some((pattern) => pattern.test(srcPath)),
  });
}

export async function copyAndWatchAssets(): Promise<CleanupFunction> {
  const { close, ready, watcher } = createWatcher(true);

  watcher
    .on('change', (srcPath) => {
      const destPath = srcPathToBuildPath(srcPath);
      console.log(`Copying updated asset: ${relativeToRoot(srcPath)}`);
      fs.copySync(srcPath, destPath);
    })
    .on('unlink', (srcPath) => {
      const destPath = srcPathToBuildPath(srcPath);
      console.log(`Removing deleted asset: ${relativeToRoot(srcPath)}`);
      fs.removeSync(destPath);
    });

  await ready;

  console.log('Watching assets for changes');

  const cleanup: CleanupFunction = async () => {
    console.log('Stopping asset watcher');
    await close();
  };

  return cleanup;
}
