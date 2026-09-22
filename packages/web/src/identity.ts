const STORAGE_KEY = "companionmaps.identity";

export interface StoredIdentity {
  code: string;
  memberId: string;
  token: string;
  name: string;
  vehicle: string | null;
}

/**
 * The member id and token are what let a reload rejoin as the same car
 * instead of leaving a ghost marker behind, so they outlive the tab.
 */
export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
    if (!parsed.code || !parsed.memberId || !parsed.token || !parsed.name) return null;

    return {
      code: parsed.code,
      memberId: parsed.memberId,
      token: parsed.token,
      name: parsed.name,
      vehicle: parsed.vehicle ?? null,
    };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: StoredIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private browsing, or storage full. Losing the resume token only costs
    // the user a re-join, so it is not worth surfacing.
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see saveIdentity */
  }
}
