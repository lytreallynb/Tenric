// The runtime's collector identity: an Ed25519 key pair and the collectors file that
// lets a verifier on the same machine trust it.
//
// The private key lives outside everything the sandbox exposes (src/runtime/sandbox.ts
// refuses a spec that would expose it). Trust in it is the operator's decision: the
// collectors file written here is read only when the verifier is pointed at it, and the
// repository's own spec/collectors/registry.json ships empty.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { stableJson } from "./util.ts";

export interface CollectorIdentity {
  /** collector_id in statements and the id of the collectors-file entry. */
  id: string;
  key_id: string;
  /** base64 SPKI DER. */
  public_key: string;
  private_key_pem: string;
  dir: string;
  collectors_path: string;
}

/** Where the key lives: TENRIC_KEY_DIR, else $XDG_CONFIG_HOME/tenric, else ~/.config/tenric. */
export function keyDir(): string {
  if (process.env.TENRIC_KEY_DIR) return resolve(process.env.TENRIC_KEY_DIR);
  return join(process.env.XDG_CONFIG_HOME ? resolve(process.env.XDG_CONFIG_HOME) : join(homedir(), ".config"), "tenric");
}

export function keyIdOf(publicKeyDer: Buffer): string {
  return createHash("sha256").update(publicKeyDer).digest("hex");
}

/** Loads the identity in `dir`, creating key and collectors file on first use. */
export function loadOrCreateIdentity(dir: string = keyDir()): CollectorIdentity {
  const keyPath = join(dir, "collector-key.pem");
  const collectorsPath = join(dir, "collectors.json");
  if (!existsSync(keyPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(keyPath, 0o600);
  }
  const private_key_pem = readFileSync(keyPath, "utf8");
  const der = createPublicKey(createPrivateKey(private_key_pem)).export({ type: "spki", format: "der" });
  const key_id = keyIdOf(der);
  const id = `tenric-runtime@${hostname()}#${key_id.slice(0, 12)}`;
  const public_key = der.toString("base64");
  const entry = {
    id, key_id, public_key,
    custody: `Private key at ${keyPath}, readable by the runtime's OS user only. The runtime signs only runs whose backend and experiment ran in an enforced sandbox that does not expose this directory.`,
    establishes: ["independent-collector", "content-hashing"],
  };
  const wanted = stableJson({ collectors_schema: "0.1.0", collectors: [entry] });
  if (!existsSync(collectorsPath) || readFileSync(collectorsPath, "utf8") !== wanted) writeFileSync(collectorsPath, wanted);
  return { id, key_id, public_key, private_key_pem, dir, collectors_path: collectorsPath };
}
