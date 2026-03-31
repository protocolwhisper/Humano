"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  type MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ISuccessResult,
  MiniKit,
  type VerifyCommandInput,
  VerificationLevel,
} from "@worldcoin/minikit-js";

import {
  clearPhotos,
  deletePhoto,
  listPhotos,
  savePhoto,
  type FilecoinPhotoRecord,
  type StoredPhoto,
} from "@/lib/photo-store";
import {
  humanizeFilecoinError,
  type FilecoinUploadResponse,
} from "@/lib/filecoin";
import {
  getProofConfig,
  isDevBypassEnabled,
  proofLabel,
} from "@/lib/world-id";

type ProofSource = "world-id" | "dev-bypass";

interface ProofDecision {
  isVerified: boolean;
  allowCamera: boolean;
  reason: string;
}

interface ProofSession {
  action: string;
  verificationLevel: VerificationLevel;
  verifiedAt: string;
  source: ProofSource;
  signal?: string;
  nullifierHash?: string | null;
  merkleRoot?: string | null;
  decision: ProofDecision;
}

interface PhotoCard extends StoredPhoto {
  previewUrl: string;
}

interface PulseCard {
  id: string;
  handle: string;
  tag: string;
  note: string;
  imageSrc: string;
  imageAlt: string;
  accent: "gold" | "ash";
  offset?: boolean;
  source: "demo" | "photo";
}

interface DemoProfile {
  id: string;
  handle: string;
  tag: string;
  note: string;
  accent: "gold" | "ash";
  portrait: string;
  offset?: boolean;
}

const PROOF_SESSION_KEY = "proofcam-proof-session";

function createDefaultDecision(
  verificationLevel: VerificationLevel,
  source: ProofSource,
): ProofDecision {
  return {
    isVerified: true,
    allowCamera: true,
    reason:
      source === "dev-bypass"
        ? `${proofLabel(verificationLevel)} unlocked with local development bypass.`
        : `${proofLabel(verificationLevel)} verified and allowed for this action.`,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const differenceMs = new Date(value).getTime() - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(differenceMs) < hour) {
    return rtf.format(Math.round(differenceMs / minute), "minute");
  }

  if (Math.abs(differenceMs) < day) {
    return rtf.format(Math.round(differenceMs / hour), "hour");
  }

  return rtf.format(Math.round(differenceMs / day), "day");
}

function createSignal() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `proofcam-${Date.now()}`;
}

function encodeSvg(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createPortraitDataUri(variant: number) {
  const configs = [
    {
      backgroundA: "#4a4a4a",
      backgroundB: "#0d0d0d",
      glow: "#6f6f6f",
      headX: 208,
      headY: 198,
      headRx: 84,
      headRy: 108,
      hairPath:
        "M118 182 C126 106 164 66 208 66 C262 66 308 118 302 196 C282 166 258 150 230 144 C182 132 152 144 118 182 Z",
      torsoPath:
        "M66 452 C88 356 146 308 210 308 C278 308 338 354 352 452 L66 452 Z",
      accentPath:
        "M112 470 L210 392 L316 470 Z",
      eyeY: 204,
      mouth: "M176 252 C192 262 224 262 240 252",
      detail: "M164 228 C188 236 228 236 252 228",
    },
    {
      backgroundA: "#3f3f3f",
      backgroundB: "#090909",
      glow: "#787878",
      headX: 212,
      headY: 196,
      headRx: 82,
      headRy: 110,
      hairPath:
        "M126 170 C134 96 176 72 220 72 C270 72 304 108 300 180 C286 154 260 130 220 126 C186 122 150 138 126 170 Z",
      torsoPath:
        "M58 452 C80 356 142 314 214 314 C288 314 340 360 360 452 L58 452 Z",
      accentPath:
        "M150 286 C166 314 188 330 214 330 C238 330 264 314 282 284 C274 344 248 374 214 374 C176 374 156 342 150 286 Z",
      eyeY: 200,
      mouth: "M178 254 C192 260 226 260 242 254",
      detail: "M150 166 C176 150 248 150 274 168",
    },
    {
      backgroundA: "#535353",
      backgroundB: "#111111",
      glow: "#888888",
      headX: 212,
      headY: 192,
      headRx: 78,
      headRy: 102,
      hairPath:
        "M132 170 C138 102 174 74 214 74 C258 74 292 100 294 170 C264 148 236 138 212 138 C188 138 160 146 132 170 Z",
      torsoPath:
        "M74 452 C94 372 152 324 214 324 C278 324 326 366 344 452 L74 452 Z",
      accentPath:
        "M146 328 C170 348 196 360 214 360 C236 360 258 350 282 326 L310 452 L118 452 Z",
      eyeY: 198,
      mouth: "M174 248 C194 272 232 272 250 248",
      detail: "M160 228 C186 240 228 240 254 228",
    },
    {
      backgroundA: "#454545",
      backgroundB: "#0a0a0a",
      glow: "#696969",
      headX: 210,
      headY: 204,
      headRx: 70,
      headRy: 96,
      hairPath:
        "M90 238 C94 118 152 84 210 84 C266 84 328 122 332 238 C310 180 270 146 210 146 C150 146 114 178 90 238 Z",
      torsoPath:
        "M72 454 C106 368 160 314 210 314 C258 314 314 370 348 454 L72 454 Z",
      accentPath:
        "M92 238 C108 298 154 348 210 348 C266 348 312 298 328 238 C308 166 264 126 210 126 C156 126 112 166 92 238 Z",
      eyeY: 206,
      mouth: "M186 252 C198 260 222 260 234 252",
      detail: "M176 230 C196 236 224 236 244 230",
    },
  ] as const;

  const config = configs[variant % configs.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 520" fill="none">
      <defs>
        <linearGradient id="bg" x1="210" y1="0" x2="210" y2="520" gradientUnits="userSpaceOnUse">
          <stop stop-color="${config.backgroundA}" />
          <stop offset="1" stop-color="${config.backgroundB}" />
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(210 164) rotate(90) scale(180 160)">
          <stop stop-color="${config.glow}" stop-opacity="0.92" />
          <stop offset="1" stop-color="#0a0a0a" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="420" height="520" fill="url(#bg)" />
      <circle cx="210" cy="164" r="174" fill="url(#glow)" />
      <path d="${config.torsoPath}" fill="#151515" />
      <path d="${config.accentPath}" fill="#252525" />
      <ellipse cx="${config.headX}" cy="${config.headY}" rx="${config.headRx}" ry="${config.headRy}" fill="#7d7d7d" />
      <path d="${config.hairPath}" fill="#1a1a1a" />
      <ellipse cx="176" cy="${config.eyeY}" rx="12" ry="7" fill="#202020" />
      <ellipse cx="244" cy="${config.eyeY}" rx="12" ry="7" fill="#202020" />
      <path d="M208 206 L198 234 L218 234 Z" fill="#656565" />
      <path d="${config.mouth}" stroke="#2a2a2a" stroke-width="8" stroke-linecap="round" />
      <path d="${config.detail}" stroke="#3b3b3b" stroke-width="8" stroke-linecap="round" />
      <rect x="34" y="34" width="352" height="452" rx="28" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
    </svg>
  `;

  return encodeSvg(svg);
}

const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "ella",
    handle: "@ella_v2",
    tag: "Humanity 99%",
    note: "Trusted signal from the Humano graph.",
    accent: "gold",
    portrait: createPortraitDataUri(0),
  },
  {
    id: "jax",
    handle: "@jax_pro",
    tag: "OG Member",
    note: "High-trust human proof with repeat participation.",
    accent: "gold",
    portrait: createPortraitDataUri(1),
    offset: true,
  },
  {
    id: "marcus",
    handle: "@marcus_real",
    tag: "Kuala Lumpur node",
    note: "Local signal cluster, device proof active.",
    accent: "ash",
    portrait: createPortraitDataUri(2),
  },
  {
    id: "rain",
    handle: "@rain_walker",
    tag: "Tokyo precinct",
    note: "Orb-backed identity with anonymous social handle.",
    accent: "gold",
    portrait: createPortraitDataUri(3),
    offset: true,
  },
];

function loadStoredProofSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(PROOF_SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProofSession>;

    if (
      typeof parsed.action !== "string" ||
      typeof parsed.verifiedAt !== "string" ||
      (parsed.source !== "world-id" && parsed.source !== "dev-bypass")
    ) {
      window.localStorage.removeItem(PROOF_SESSION_KEY);
      return null;
    }

    const verificationLevel =
      parsed.verificationLevel === VerificationLevel.Orb
        ? VerificationLevel.Orb
        : VerificationLevel.Device;

    return {
      action: parsed.action,
      verificationLevel,
      verifiedAt: parsed.verifiedAt,
      source: parsed.source,
      signal: parsed.signal,
      nullifierHash: parsed.nullifierHash ?? null,
      merkleRoot: parsed.merkleRoot ?? null,
      decision:
        parsed.decision ??
        createDefaultDecision(verificationLevel, parsed.source),
    };
  } catch {
    window.localStorage.removeItem(PROOF_SESSION_KEY);
    return null;
  }
}

function persistProofSession(session: ProofSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(PROOF_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(PROOF_SESSION_KEY, JSON.stringify(session));
}

function revokePhotoUrls(photos: PhotoCard[]) {
  for (const photo of photos) {
    URL.revokeObjectURL(photo.previewUrl);
  }
}

async function captureVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1080;
  const height = video.videoHeight || 1440;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas capture is not available.");
  }

  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });

  if (!blob) {
    throw new Error("Could not capture the current camera frame.");
  }

  return blob;
}

function stopActiveStream(
  streamRef: MutableRefObject<MediaStream | null>,
  videoRef: MutableRefObject<HTMLVideoElement | null>,
) {
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;

  if (videoRef.current) {
    videoRef.current.srcObject = null;
  }
}

function humanizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

function createPulseCards(photos: PhotoCard[]): PulseCard[] {
  const liveCards: PulseCard[] = photos.slice(0, 4).map((photo, index) => ({
    id: photo.id,
    handle: `@capture_${photo.id.slice(0, 5).replace(/[^a-z0-9]/gi, "").toLowerCase()}`,
    tag: photo.filecoin ? "Calibration sync" : proofLabel(photo.verificationLevel),
    note: photo.filecoin
      ? `PieceCID ${photo.filecoin.pieceCid.slice(0, 10)}...`
      : `Saved ${formatRelativeTime(photo.createdAt)}`,
    imageSrc: photo.previewUrl,
    imageAlt: `Captured ${formatDate(photo.createdAt)}`,
    accent: photo.filecoin ? "gold" : "ash",
    offset: index % 2 === 1,
    source: "photo",
  }));

  const fillerCards: PulseCard[] = DEMO_PROFILES.slice(
    0,
    Math.max(0, 4 - liveCards.length),
  ).map((profile) => ({
      id: profile.id,
      handle: profile.handle,
      tag: profile.tag,
      note: profile.note,
      imageSrc: profile.portrait,
      imageAlt: `${profile.handle} demo portrait`,
      accent: profile.accent,
      offset: profile.offset,
      source: "demo",
    }));

  return [...liveCards, ...fillerCards];
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5H20" />
      <path d="M4 12H17" />
      <path d="M4 16.5H20" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16L21 21" />
    </svg>
  );
}

function VerifiedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.6L14.6 5L18 5.4L18.6 8.8L21 11.4L18.6 14L18 17.4L14.6 18L12 20.4L9.4 18L6 17.4L5.4 14L3 11.4L5.4 8.8L6 5.4L9.4 5L12 2.6Z" />
      <path d="M8.4 11.8L10.6 14L15.6 9" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M14.9 9.1L13.4 13.4L9.1 14.9L10.6 10.6L14.9 9.1Z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 6.5L9.1 4H14.9L16.5 6.5H18.5C19.9 6.5 21 7.6 21 9V17.5C21 18.9 19.9 20 18.5 20H5.5C4.1 20 3 18.9 3 17.5V9C3 7.6 4.1 6.5 5.5 6.5H7.5Z" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M18.5 4V8.2" />
      <path d="M16.4 6.1H20.6" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17H17L15.8 15.4V11.3C15.8 9 14.1 7.1 12 6.7C9.9 7.1 8.2 9 8.2 11.3V15.4L7 17Z" />
      <path d="M10.2 19C10.7 20.1 11.2 20.5 12 20.5C12.8 20.5 13.3 20.1 13.8 19" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5.2 19.3C6.4 16.6 8.9 15.1 12 15.1C15.1 15.1 17.6 16.6 18.8 19.3" />
    </svg>
  );
}

export function ProofCameraTemplate() {
  const [selectedProof, setSelectedProof] = useState<VerificationLevel>(
    VerificationLevel.Device,
  );
  const [proofSession, setProofSession] = useState<ProofSession | null>(null);
  const [photos, setPhotos] = useState<PhotoCard[]>([]);
  const [isWorldAppReady, setIsWorldAppReady] = useState(false);
  const [isCheckingWorldApp, setIsCheckingWorldApp] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photosRef = useRef<PhotoCard[]>([]);
  const activeProofConfig = getProofConfig(selectedProof);
  const pulseCards = createPulseCards(photos);
  const liveStatus = proofSession?.decision.allowCamera
    ? "Live verification status: camera unlocked"
    : isWorldAppReady
      ? "Live verification status: world app detected"
      : isCheckingWorldApp
        ? "Live verification status: checking stack"
        : "Live verification status: browser preview mode";

  async function refreshGallery() {
    setIsGalleryLoading(true);

    try {
      const storedPhotos = await listPhotos();
      const nextPhotos = storedPhotos.map((photo) => ({
        ...photo,
        previewUrl: URL.createObjectURL(photo.blob),
      }));

      setPhotos((current) => {
        revokePhotoUrls(current);
        return nextPhotos;
      });
    } catch (refreshError) {
      setError(humanizeError(refreshError));
    } finally {
      setIsGalleryLoading(false);
    }
  }

  function resetMessages() {
    setNotice(null);
    setError(null);
  }

  function formatCompactHash(value: string) {
    if (value.length <= 18) {
      return value;
    }

    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  }

  function updateProofSession(session: ProofSession | null) {
    setProofSession(session);
    persistProofSession(session);
  }

  async function unlockWithDevBypass() {
    const bypassSession: ProofSession = {
      action: activeProofConfig.action,
      verificationLevel: selectedProof,
      verifiedAt: new Date().toISOString(),
      source: "dev-bypass",
      nullifierHash: null,
      merkleRoot: null,
      decision: createDefaultDecision(selectedProof, "dev-bypass"),
    };

    updateProofSession(bypassSession);
    setNotice(
      `${proofLabel(selectedProof)} unlocked with local dev bypass. Replace this with real World ID credentials before shipping.`,
    );
  }

  async function handleVerify() {
    resetMessages();

    if (!MiniKit.isInstalled()) {
      if (isDevBypassEnabled()) {
        await unlockWithDevBypass();
        return;
      }

      setError(
        "World App was not detected. Open the mini app inside World App or enable NEXT_PUBLIC_ALLOW_DEV_BYPASS for browser preview.",
      );
      return;
    }

    setIsVerifying(true);

    try {
      const signal = createSignal();
      const verifyPayload: VerifyCommandInput = {
        action: activeProofConfig.action,
        signal,
        verification_level: selectedProof,
      };

      const { finalPayload } =
        await MiniKit.commandsAsync.verify(verifyPayload);

      if (finalPayload.status === "error") {
        setError(
          `Verification was cancelled or failed with code "${finalPayload.error_code}".`,
        );
        return;
      }

      const verificationResponse = await fetch("/api/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: finalPayload as ISuccessResult,
          action: activeProofConfig.action,
          signal,
        }),
      });

      const verificationBody = (await verificationResponse.json()) as
        | {
            success: false;
            error?: string;
          }
        | {
            success: true;
            verifiedAt: string;
            decision: ProofDecision;
            proof: {
              action: string;
              signal?: string;
              nullifierHash: string;
              merkleRoot: string;
              verificationLevel: VerificationLevel;
            };
          };

      if (!verificationResponse.ok || !verificationBody.success) {
        const failureMessage =
          verificationBody.success === false
            ? verificationBody.error
            : undefined;

        setError(
          failureMessage ?? "World ID verification failed on the backend.",
        );
        return;
      }

      const verifiedSession: ProofSession = {
        action: verificationBody.proof.action,
        verificationLevel: verificationBody.proof.verificationLevel,
        verifiedAt: verificationBody.verifiedAt ?? new Date().toISOString(),
        source: "world-id",
        signal: verificationBody.proof.signal,
        nullifierHash: verificationBody.proof.nullifierHash,
        merkleRoot: verificationBody.proof.merkleRoot,
        decision: verificationBody.decision,
      };

      updateProofSession(verifiedSession);
      setNotice(`${verificationBody.decision.reason}`);
    } catch (verifyError) {
      setError(humanizeError(verifyError));
    } finally {
      setIsVerifying(false);
    }
  }

  async function startCamera() {
    resetMessages();

    if (!proofSession) {
      setError("Verify first, then start the camera.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Live preview is not available here. Use Quick capture to open the device camera instead.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1440 },
          height: { ideal: 1440 },
        },
        audio: false,
      });

      stopActiveStream(streamRef, videoRef);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);
      setCameraError(null);
      setNotice("Live camera ready.");
    } catch (streamError) {
      setCameraReady(false);
      setCameraError(
        humanizeError(streamError) ||
          "Camera access failed. Try Quick capture instead.",
      );
    }
  }

  function stopCamera() {
    stopActiveStream(streamRef, videoRef);
    setCameraReady(false);
  }

  async function persistPhoto(blob: Blob) {
    if (!proofSession) {
      setError("Verify first, then take a photo.");
      return;
    }

    setIsSavingPhoto(true);

    try {
      const nextPhoto: StoredPhoto = {
        id: createSignal(),
        createdAt: new Date().toISOString(),
        mimeType: blob.type || "image/jpeg",
        verificationLevel: proofSession.verificationLevel,
        worldAction: proofSession.action,
        blob,
      };

      await savePhoto(nextPhoto);
      await refreshGallery();
      setNotice("Photo saved locally inside the mini app.");
    } catch (photoError) {
      setError(humanizeError(photoError));
    } finally {
      setIsSavingPhoto(false);
    }
  }

  async function handleCaptureFrame() {
    resetMessages();

    if (!videoRef.current) {
      setError("Start the live camera before capturing a frame.");
      return;
    }

    try {
      const capturedBlob = await captureVideoFrame(videoRef.current);
      await persistPhoto(capturedBlob);
    } catch (captureError) {
      setError(humanizeError(captureError));
    }
  }

  async function handleQuickCapture(event: ChangeEvent<HTMLInputElement>) {
    resetMessages();

    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    await persistPhoto(file);
    event.target.value = "";
  }

  async function handleDeletePhoto(id: string) {
    resetMessages();

    try {
      await deletePhoto(id);
      await refreshGallery();
      setNotice("Photo removed from the local gallery.");
    } catch (deleteError) {
      setError(humanizeError(deleteError));
    }
  }

  async function handleUploadToFilecoin(photo: StoredPhoto) {
    resetMessages();
    setUploadingPhotoId(photo.id);

    try {
      const formData = new FormData();
      const filename = `proofcam-${photo.id}.jpg`;
      const uploadFile = new File([photo.blob], filename, {
        type: photo.mimeType,
      });

      formData.append("file", uploadFile);
      formData.append("createdAt", photo.createdAt);
      formData.append("verificationLevel", photo.verificationLevel);
      formData.append("worldAction", photo.worldAction ?? "unknown-action");

      const response = await fetch("/api/filecoin/upload", {
        method: "POST",
        body: formData,
      });

      const responseBody = (await response.json()) as FilecoinUploadResponse;

      if (!response.ok || !responseBody.success) {
        const message =
          responseBody.success === false
            ? humanizeFilecoinError(responseBody.error)
            : "Filecoin upload failed.";

        setError(message);
        return;
      }

      const updatedPhoto: StoredPhoto = {
        ...photo,
        filecoin: responseBody.filecoin as FilecoinPhotoRecord,
      };

      await savePhoto(updatedPhoto);
      await refreshGallery();
      setNotice(
        `Photo uploaded to Filecoin Calibration. PieceCID: ${responseBody.filecoin.pieceCid}`,
      );
    } catch (uploadError) {
      setError(humanizeError(uploadError));
    } finally {
      setUploadingPhotoId(null);
    }
  }

  async function handleClearLibrary() {
    resetMessages();

    try {
      await clearPhotos();
      await refreshGallery();
      setNotice("Local photo library cleared.");
    } catch (clearError) {
      setError(humanizeError(clearError));
    }
  }

  function handleResetProof() {
    resetMessages();
    stopCamera();
    updateProofSession(null);
    setSelectedProof(VerificationLevel.Device);
    setNotice("Local proof session reset.");
  }

  useEffect(() => {
    let checks = 0;
    let cancelled = false;

    const intervalId = window.setInterval(() => {
      const installed = MiniKit.isInstalled();
      setIsWorldAppReady(installed);
      checks += 1;

      if (installed || checks >= 20) {
        setIsCheckingWorldApp(false);
        window.clearInterval(intervalId);
      }
    }, 250);

    const storedSession = loadStoredProofSession();
    setProofSession(storedSession);

    if (storedSession) {
      setSelectedProof(storedSession.verificationLevel);
    }

    void (async () => {
      try {
        const storedPhotos = await listPhotos();

        if (cancelled) {
          return;
        }

        const nextPhotos = storedPhotos.map((photo) => ({
          ...photo,
          previewUrl: URL.createObjectURL(photo.blob),
        }));

        setPhotos((current) => {
          revokePhotoUrls(current);
          return nextPhotos;
        });
      } catch (refreshError) {
        if (!cancelled) {
          setError(humanizeError(refreshError));
        }
      } finally {
        if (!cancelled) {
          setIsGalleryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      stopActiveStream(streamRef, videoRef);
      revokePhotoUrls(photosRef.current);
    };
  }, []);

  return (
    <div className="app-frame humano-frame">
      <header className="humano-topbar">
        <button type="button" className="icon-button" aria-label="Open menu">
          <MenuIcon />
        </button>
        <div className="brand-lockup">
          <span className="brand-word">HUMANO</span>
          <span className="brand-subline">verified humans only</span>
        </div>
        <button type="button" className="icon-button" aria-label="Search">
          <SearchIcon />
        </button>
      </header>

      <div className="ticker-strip">
        <span className="ticker-dot" />
        <span>{liveStatus}</span>
      </div>

      <section className="hero-panel">
        <span className="eyebrow-badge">Verified humans only</span>

        <h1 className="hero-title">
          <span>THE</span> <em>PULSE</em>
        </h1>

        <p className="hero-copy">
          Real people. Real moments. Strictly non-synthetic identities verified
          via the Humano protocol.
        </p>

        <div className="hero-stats">
          <div className="hero-stat">
            <strong>
              {proofSession?.decision.allowCamera
                ? proofLabel(proofSession.verificationLevel)
                : "Locked"}
            </strong>
            <span>
              {proofSession
                ? `Unlocked ${formatRelativeTime(proofSession.verifiedAt)}`
                : "Verify to unlock the camera"}
            </span>
          </div>

          <div className="hero-stat">
            <strong>{photos.length}</strong>
            <span>{photos.length === 1 ? "Live capture" : "Live captures"}</span>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void handleVerify()}
            disabled={isVerifying}
          >
            {isVerifying ? "Verifying..." : `Verify with ${activeProofConfig.label}`}
          </button>

          <button
            type="button"
            className="button button-secondary"
            onClick={() => void startCamera()}
            disabled={!proofSession || cameraReady}
          >
            {cameraReady ? "Camera ready" : "Open live camera"}
          </button>
        </div>
      </section>

      {notice ? <div className="notice notice-success">{notice}</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <section className="pulse-grid-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Signal feed</span>
            <h2>Verified humans in motion</h2>
          </div>
          <span className="status-chip">
            {isWorldAppReady ? "World App ready" : "Preview mode"}
          </span>
        </div>

        <div className="pulse-grid">
          {pulseCards.map((card) => (
            <article
              key={card.id}
              className={`pulse-card ${card.offset ? "offset" : ""}`}
              data-accent={card.accent}
              data-source={card.source}
            >
              <div className="pulse-media">
                <Image
                  src={card.imageSrc}
                  alt={card.imageAlt}
                  width={420}
                  height={520}
                  sizes="(max-width: 520px) 46vw, 220px"
                  unoptimized
                />
                <span className="pulse-badge">
                  <VerifiedIcon />
                  Verified
                </span>
              </div>

              <div className="pulse-card-body">
                <div className="pulse-handle-row">
                  <strong>{card.handle}</strong>
                  <span className="verified-mark">
                    <VerifiedIcon />
                  </span>
                </div>

                <span className="pulse-chip">{card.tag}</span>
                <p>{card.note}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="control-grid">
        <article className="console-card">
          <div className="section-heading compact">
            <div>
              <span className="section-kicker">Verification core</span>
              <h2>Unlock the feed</h2>
            </div>
            <span className="status-chip">
              {proofSession ? "Verified" : "Awaiting proof"}
            </span>
          </div>

          <p className="section-copy">
            Pick the proof strength, verify with World ID, then let Humano open
            camera access only for real humans.
          </p>

          <div className="proof-options">
            <button
              type="button"
              className={`proof-toggle ${
                selectedProof === VerificationLevel.Device ? "active" : ""
              }`}
              onClick={() => setSelectedProof(VerificationLevel.Device)}
            >
              <strong>Device proof</strong>
              <span>Fastest unlock for the standard Humano flow.</span>
            </button>

            <button
              type="button"
              className={`proof-toggle ${
                selectedProof === VerificationLevel.Orb ? "active" : ""
              }`}
              onClick={() => setSelectedProof(VerificationLevel.Orb)}
            >
              <strong>Orb human proof</strong>
              <span>Higher-assurance verification for stronger anti-bot rules.</span>
            </button>
          </div>

          <div className="status-row">
            <span className="pill">
              Mode <strong>{activeProofConfig.label}</strong>
            </span>
            <span className="code-chip">{activeProofConfig.action}</span>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleVerify()}
              disabled={isVerifying}
            >
              {isVerifying ? "Verifying..." : "Run verification"}
            </button>

            <button
              type="button"
              className="button button-ghost"
              onClick={handleResetProof}
              disabled={!proofSession}
            >
              Reset proof
            </button>
          </div>

          {proofSession ? (
            <div className="console-summary">
              <div className="status-row">
                <span className="pill pill-success">
                  Camera {proofSession.decision.allowCamera ? "allowed" : "blocked"}
                </span>
                <span className="pill">
                  Source{" "}
                  <strong>
                    {proofSession.source === "world-id"
                      ? "Verified proof"
                      : "Dev bypass"}
                  </strong>
                </span>
              </div>

              <p className="helper">
                <strong>Reason:</strong> {proofSession.decision.reason}
              </p>

              <p className="helper">
                <strong>Verified:</strong> {formatDate(proofSession.verifiedAt)}
              </p>

              {proofSession.nullifierHash ? (
                <div className="hash-stack">
                  <span className="code-chip">
                    nullifier {formatCompactHash(proofSession.nullifierHash)}
                  </span>
                  <span className="code-chip">
                    merkle {formatCompactHash(proofSession.merkleRoot ?? "")}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {isDevBypassEnabled() ? (
            <p className="helper">
              <strong>Dev bypass:</strong> enabled for browser preview while you
              wait on production credentials.
            </p>
          ) : null}
        </article>

        <article className="console-card">
          <div className="section-heading compact">
            <div>
              <span className="section-kicker">Capture desk</span>
              <h2>Shoot the moment</h2>
            </div>
            <span className="status-chip">{cameraReady ? "Live" : "Standby"}</span>
          </div>

          <p className="section-copy">
            Once a human clears proof, Humano can open the live camera or fall
            back to direct device capture.
          </p>

          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void startCamera()}
              disabled={!proofSession || cameraReady}
            >
              Start live camera
            </button>

            <button
              type="button"
              className="button button-ghost"
              onClick={stopCamera}
              disabled={!cameraReady}
            >
              Stop camera
            </button>

            <label
              className={`file-label ${!proofSession ? "disabled" : ""}`}
              aria-disabled={!proofSession}
            >
              Quick capture
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={!proofSession || isSavingPhoto}
                onChange={(event) => void handleQuickCapture(event)}
              />
            </label>
          </div>

          <div className="camera-shell">
            <div className="camera-stage">
              {cameraReady ? (
                <video
                  ref={videoRef}
                  className="camera-video"
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <div className="camera-placeholder">
                  <strong>Live preview appears here after verification.</strong>
                  <span>
                    If the preview does not open in browser mode, use Quick
                    capture to jump straight into the device camera.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleCaptureFrame()}
              disabled={!cameraReady || isSavingPhoto}
            >
              {isSavingPhoto ? "Saving photo..." : "Capture frame"}
            </button>
          </div>

          <p className="helper">
            <strong>Storage:</strong> every capture stays in IndexedDB on this
            device until you clear it.
          </p>

          {cameraError ? <p className="helper helper-warning">{cameraError}</p> : null}
        </article>
      </section>

      <section className="vault-card">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Capture vault</span>
            <h2>Local proof-backed library</h2>
          </div>

          <div className="button-row tight">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void refreshGallery()}
            >
              Refresh
            </button>

            <button
              type="button"
              className="button button-ghost button-danger"
              onClick={() => void handleClearLibrary()}
              disabled={!photos.length}
            >
              Clear
            </button>
          </div>
        </div>

        <p className="section-copy">
          Local captures can stay private in-app or sync to Filecoin
          Calibration after the shot lands.
        </p>

        {isGalleryLoading ? (
          <p className="helper">Loading the Humano vault...</p>
        ) : photos.length ? (
          <div className="vault-grid">
            {photos.map((photo) => (
              <article key={photo.id} className="vault-item">
                <div className="vault-thumb">
                  <Image
                    src={photo.previewUrl}
                    alt={`Captured ${formatDate(photo.createdAt)}`}
                    width={420}
                    height={520}
                    sizes="(max-width: 520px) 100vw, 220px"
                    unoptimized
                  />
                </div>

                <div className="vault-body">
                  <div className="pulse-handle-row">
                    <strong>{formatDate(photo.createdAt)}</strong>
                    <span className="verified-mark">
                      <VerifiedIcon />
                    </span>
                  </div>

                  <div className="vault-meta">
                    <span>{proofLabel(photo.verificationLevel)}</span>
                    <span>{photo.mimeType}</span>
                    <span>
                      {photo.filecoin
                        ? `PieceCID ${formatCompactHash(photo.filecoin.pieceCid)}`
                        : "Stored locally only"}
                    </span>
                    {photo.filecoin?.transactionHash ? (
                      <span>Tx {formatCompactHash(photo.filecoin.transactionHash)}</span>
                    ) : null}
                  </div>

                  <div className="button-row tight">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleUploadToFilecoin(photo)}
                      disabled={
                        uploadingPhotoId === photo.id ||
                        photo.filecoin?.status === "uploaded"
                      }
                    >
                      {photo.filecoin?.status === "uploaded"
                        ? "Uploaded"
                        : uploadingPhotoId === photo.id
                          ? "Uploading..."
                          : "Upload"}
                    </button>

                    <button
                      type="button"
                      className="button button-ghost button-danger"
                      onClick={() => void handleDeletePhoto(photo.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            No captures yet. Verify a human, open the camera, and let the feed
            start with a real moment.
          </div>
        )}
      </section>

      <nav className="humano-nav" aria-label="Primary">
        <button type="button" className="nav-item active">
          <GridIcon />
          <span>Feed</span>
        </button>

        <button type="button" className="nav-item">
          <CompassIcon />
          <span>Explore</span>
        </button>

        <button
          type="button"
          className="nav-camera"
          onClick={() =>
            proofSession ? void startCamera() : void handleVerify()
          }
          aria-label={proofSession ? "Open camera" : "Verify to unlock camera"}
        >
          <CameraIcon />
        </button>

        <button type="button" className="nav-item">
          <BellIcon />
          <span>Alerts</span>
        </button>

        <button type="button" className="nav-item">
          <UserIcon />
          <span>User</span>
        </button>
      </nav>
    </div>
  );
}
