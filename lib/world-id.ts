import { VerificationLevel } from "@worldcoin/minikit-js";

const FALLBACK_DEVICE_ACTION = "photo-device-proof";
const FALLBACK_HUMAN_ACTION = "photo-human-proof";

export function getProofConfig(level: VerificationLevel) {
  if (level === VerificationLevel.Orb) {
    return {
      action:
        process.env.NEXT_PUBLIC_WORLD_ACTION_HUMAN ?? FALLBACK_HUMAN_ACTION,
      label: "Orb human proof",
      summary:
        "Stronger proof-of-personhood for features that need verified humans.",
    };
  }

  return {
    action:
      process.env.NEXT_PUBLIC_WORLD_ACTION_DEVICE ?? FALLBACK_DEVICE_ACTION,
    label: "Device proof",
    summary:
      "Faster default flow that still gates access to this device inside World App.",
  };
}

export function proofLabel(level: VerificationLevel) {
  return level === VerificationLevel.Orb ? "Orb human proof" : "Device proof";
}

export function isDevBypassEnabled() {
  return process.env.NEXT_PUBLIC_ALLOW_DEV_BYPASS === "true";
}
