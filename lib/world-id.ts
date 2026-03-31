import { VerificationLevel } from "@worldcoin/minikit-js";

const FALLBACK_DEVICE_ACTION = "unlock-camera-device";
const FALLBACK_HUMAN_ACTION = "unlock-camera-human";

export function getProofConfig(level: VerificationLevel) {
  if (level === VerificationLevel.Orb) {
    return {
      action:
        process.env.NEXT_PUBLIC_WORLD_ACTION_HUMAN ?? FALLBACK_HUMAN_ACTION,
      label: "Orb human proof",
      summary:
        "Stronger proof-of-personhood to unlock a verified camera session.",
    };
  }

  return {
      action:
        process.env.NEXT_PUBLIC_WORLD_ACTION_DEVICE ?? FALLBACK_DEVICE_ACTION,
      label: "Device proof",
      summary:
        "Faster default flow to unlock a verified camera session inside World App.",
    };
}

export function proofLabel(level: VerificationLevel) {
  return level === VerificationLevel.Orb ? "Orb human proof" : "Device proof";
}

export function isDevBypassEnabled() {
  return process.env.NEXT_PUBLIC_ALLOW_DEV_BYPASS === "true";
}
