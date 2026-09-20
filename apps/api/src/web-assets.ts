import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve, sep } from "node:path";

const assetNames = ["index.html", "app.js", "styles.css"] as const;

export type WebAssetName = (typeof assetNames)[number];

export function resolveWebAssetRoot(configuredRoot?: string): string {
  const root = resolve(
    configuredRoot ?? fileURLToPath(new URL("../../web/", import.meta.url)),
  );

  for (const assetName of assetNames) {
    const assetPath = resolveAssetPath(root, assetName);
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      throw new Error("NativePOS web assets are unavailable");
    }
  }

  return root;
}

export function readWebAsset(root: string, assetName: WebAssetName): string {
  return readFileSync(resolveAssetPath(root, assetName), "utf8");
}

function resolveAssetPath(root: string, assetName: WebAssetName): string {
  const assetPath = resolve(root, assetName);
  const childPath = relative(root, assetPath);
  if (
    childPath === "" ||
    childPath === ".." ||
    childPath.startsWith(".." + sep) ||
    isAbsolute(childPath)
  ) {
    throw new Error("NativePOS web assets are unavailable");
  }
  return assetPath;
}
