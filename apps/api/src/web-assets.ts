import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve, sep } from "node:path";

const assetNames = ["index.html", "app.js", "styles.css"] as const;

export type WebAssetName = (typeof assetNames)[number];

export function resolveWebAssetRoot(configuredRoot?: string): string {
  const root = resolve(
    configuredRoot ?? fileURLToPath(new URL("../../web/", import.meta.url)),
  );

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error("NativePOS web assets are unavailable");
  }

  const canonicalRoot = realpathSync(root);

  for (const assetName of assetNames) {
    const assetPath = resolveAssetPath(canonicalRoot, assetName);
    if (
      !existsSync(assetPath) ||
      !statSync(assetPath).isFile() ||
      !isWithinRoot(canonicalRoot, realpathSync(assetPath))
    ) {
      throw new Error("NativePOS web assets are unavailable");
    }
  }

  return canonicalRoot;
}

export function readWebAsset(root: string, assetName: WebAssetName): string {
  return readFileSync(resolveAssetPath(root, assetName), "utf8");
}

function resolveAssetPath(root: string, assetName: WebAssetName): string {
  const assetPath = resolve(root, assetName);

  if (!isWithinRoot(root, assetPath)) {
    throw new Error("NativePOS web assets are unavailable");
  }

  return assetPath;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const childPath = relative(root, candidate);

  return (
    childPath !== "" &&
    childPath !== ".." &&
    !childPath.startsWith(".." + sep) &&
    !isAbsolute(childPath)
  );
}
