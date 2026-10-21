import crypto from "node:crypto";

export const FACE_DESCRIPTOR_LENGTH = 128;

export function isFaceDescriptor(value) {
  return (
    Array.isArray(value) &&
    value.length === FACE_DESCRIPTOR_LENGTH &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

export function encryptFaceDescriptor(descriptor, keyHex) {
  if (!isFaceDescriptor(descriptor)) throw new TypeError("Invalid face descriptor");
  const key = readKey(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(descriptor), "utf8"),
    cipher.final(),
  ]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptFaceDescriptor(value, keyHex) {
  if (typeof value !== "string") return null;
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, ...extra] = value.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !ciphertextEncoded || extra.length) return null;

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      readKey(keyHex),
      Buffer.from(ivEncoded, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const descriptor = JSON.parse(plaintext);
    return isFaceDescriptor(descriptor) ? descriptor : null;
  } catch {
    return null;
  }
}

export function euclideanDistance(left, right) {
  if (!isFaceDescriptor(left) || !isFaceDescriptor(right)) {
    throw new TypeError("Euclidean distance requires two valid face descriptors");
  }
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0));
}

function readKey(keyHex) {
  if (typeof keyHex !== "string" || !/^[\da-f]{64}$/i.test(keyHex)) {
    throw new Error("FACE_DESCRIPTOR_KEY must be a 64-character hex-encoded key");
  }
  return Buffer.from(keyHex, "hex");
}
