import { randomBytes, randomUUID } from "node:crypto";

/** No 0/O, 1/I/L, 5/S, 8/B — a join code gets read aloud across a car park. */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export function newConvoyCode(): string {
  const pick = (length: number): string => {
    const bytes = randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    return out;
  };

  return `${pick(3)}-${pick(3)}`;
}

export const newId = (): string => randomUUID();

/** Bearer token proving a client owns a member id across reconnects. */
export const newToken = (): string => randomBytes(24).toString("base64url");
