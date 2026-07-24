#!/usr/bin/env node
// Cut Protocol — license key issuing tool (OWNER-SIDE ONLY).
//
// This file is EXCLUDED from the packaged build (see root package.json
// build.files "!electron/licenseTool.cjs"). It never ships to a customer and
// it never touches the network.
//
//   node electron/licenseTool.cjs keygen
//       Generates an Ed25519 keypair. Prints the PUBLIC key (paste into
//       electron/license.cjs → PUBLIC_KEY_B64) and writes the PRIVATE key to
//       a path you choose with --out. KEEP THE PRIVATE KEY OFF THIS REPO —
//       put it in a password manager or an encrypted volume. If it leaks,
//       anyone can mint keys and you have to rotate the public key in a new
//       release.
//
//   node electron/licenseTool.cjs sign --key <private.pem> --licensee "Name" [--exp 2027-01-01] [--plan pro]
//       Prints a license string. Send it to the customer as a file called
//       `license.key`, to be dropped in:
//         Windows  %AppData%\Cut Protocol\license.key
//
//   node electron/licenseTool.cjs verify --file <license.key> --pub <base64>
//       Sanity-check a key you just issued.

const crypto = require("crypto");
const fs = require("fs");

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const cmd = process.argv[2];

if (cmd === "keygen") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ format: "der", type: "spki" });
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const out = argOf("out", "cutprotocol-license-private.pem");
  fs.writeFileSync(out, privPem, { mode: 0o600 });
  console.log("PRIVATE KEY written to:", out);
  console.log("  ^ move this somewhere safe and NEVER commit it.\n");
  console.log("PUBLIC KEY — paste this into electron/license.cjs PUBLIC_KEY_B64:\n");
  console.log(pubDer.toString("base64"));
  process.exit(0);
}

if (cmd === "sign") {
  const keyPath = argOf("key");
  const licensee = argOf("licensee");
  if (!keyPath || !licensee) {
    console.error("usage: sign --key <private.pem> --licensee \"Name\" [--exp YYYY-MM-DD] [--plan pro]");
    process.exit(2);
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  const payload = {
    licensee,
    plan: argOf("plan", "personal"),
    issued: new Date().toISOString().slice(0, 10),
    ...(argOf("exp") ? { exp: argOf("exp") } : {}),
  };
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, payloadBuf, privateKey);
  console.log(`CP1.${b64url(payloadBuf)}.${b64url(sig)}`);
  process.exit(0);
}

if (cmd === "verify") {
  const file = argOf("file");
  const pub = argOf("pub");
  if (!file || !pub) {
    console.error("usage: verify --file <license.key> --pub <base64 public key>");
    process.exit(2);
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "CP1") {
    console.error("malformed key");
    process.exit(1);
  }
  const key = crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
  const payloadBuf = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const sigBuf = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const ok = crypto.verify(null, payloadBuf, key, sigBuf);
  console.log(ok ? "VALID" : "INVALID", "-", payloadBuf.toString("utf8"));
  process.exit(ok ? 0 : 1);
}

console.error("commands: keygen | sign | verify   (see the header of this file)");
process.exit(2);
