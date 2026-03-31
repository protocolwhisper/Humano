"use client";

import Image from "next/image";
import { keccak256, stringToHex } from "viem";
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
  type HumanoProtocolRecordResponse,
  type FilecoinUploadResponse,
} from "@/lib/filecoin";
import type { HumanoProtocolRecord } from "@/lib/humano-protocol";
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
  expiresAt: string;
  source: ProofSource;
  signal?: string;
  nullifierHash?: string | null;
  merkleRoot?: string | null;
  backgroundedAt?: string | null;
  uploaderKey: string;
  decision: ProofDecision;
}

interface PhotoCard extends StoredPhoto {
  previewUrl: string;
}

const PROOF_SESSION_KEY = "proofcam-proof-session";
const PROOF_SESSION_NOTICE_KEY = "proofcam-proof-session-notice";
const PROOF_SESSION_TTL_MS = 15 * 60 * 1000;
const PROOF_SESSION_BACKGROUND_GRACE_MS = 75 * 1000;
const PROFILE_CALLSIGNS_A = [
  "Elara",
  "Nova",
  "Vanta",
  "Kairo",
  "Lyric",
  "Sable",
  "Astra",
  "Cinder",
];
const PROFILE_CALLSIGNS_B = [
  "Vox",
  "Sync",
  "Trace",
  "Pulse",
  "Grid",
  "Vector",
  "Static",
  "Drift",
];

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
        : `${proofLabel(verificationLevel)} verified and unlocked for this camera session.`,
  };
}

function deriveUploaderKey(input: {
  source: ProofSource;
  action: string;
  verifiedAt: string;
  nullifierHash?: string | null;
}) {
  const seed =
    input.source === "world-id" && input.nullifierHash
      ? `world:${input.nullifierHash}`
      : `dev:${input.action}:${input.verifiedAt}`;

  return keccak256(stringToHex(seed));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function createSignal() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `proofcam-${Date.now()}`;
}

function createSessionExpiry(baseDate?: string) {
  const base = baseDate ? new Date(baseDate) : new Date();

  return new Date(base.getTime() + PROOF_SESSION_TTL_MS).toISOString();
}

function setSessionNotice(message: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROOF_SESSION_NOTICE_KEY, message);
}

function consumeSessionNotice() {
  if (typeof window === "undefined") {
    return null;
  }

  const notice = window.localStorage.getItem(PROOF_SESSION_NOTICE_KEY);

  if (!notice) {
    return null;
  }

  window.localStorage.removeItem(PROOF_SESSION_NOTICE_KEY);
  return notice;
}

function getExpiredSessionReason(session: Pick<ProofSession, "expiresAt" | "backgroundedAt">) {
  const now = Date.now();
  const expiresAt = Date.parse(session.expiresAt);

  if (Number.isFinite(expiresAt) && expiresAt <= now) {
    return "Your verification session timed out. Sign in with World ID again.";
  }

  if (session.backgroundedAt) {
    const backgroundedAt = Date.parse(session.backgroundedAt);

    if (
      Number.isFinite(backgroundedAt) &&
      now - backgroundedAt >= PROOF_SESSION_BACKGROUND_GRACE_MS
    ) {
      return "Your verification session expired after the mini app was closed. Sign in with World ID again.";
    }
  }

  return null;
}

function createActiveSession(session: ProofSession): ProofSession {
  return {
    ...session,
    expiresAt: createSessionExpiry(),
    backgroundedAt: null,
  };
}

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

    const session: ProofSession = {
      action: parsed.action,
      verificationLevel,
      verifiedAt: parsed.verifiedAt,
      expiresAt:
        typeof parsed.expiresAt === "string"
          ? parsed.expiresAt
          : createSessionExpiry(parsed.verifiedAt),
      source: parsed.source,
      signal: parsed.signal,
      nullifierHash: parsed.nullifierHash ?? null,
      merkleRoot: parsed.merkleRoot ?? null,
      backgroundedAt:
        typeof parsed.backgroundedAt === "string" ? parsed.backgroundedAt : null,
      uploaderKey:
        parsed.uploaderKey ??
        deriveUploaderKey({
          source: parsed.source,
          action: parsed.action,
          verifiedAt: parsed.verifiedAt,
          nullifierHash: parsed.nullifierHash ?? null,
        }),
      decision:
        parsed.decision ??
        createDefaultDecision(verificationLevel, parsed.source),
    };

    const expirationReason = getExpiredSessionReason(session);

    if (expirationReason) {
      window.localStorage.removeItem(PROOF_SESSION_KEY);
      setSessionNotice(expirationReason);
      return null;
    }

    return session;
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

function seedNumber(seed: string, offset: number) {
  return Number.parseInt(seed.slice(offset, offset + 6), 16) || 0;
}

function createProfileIdentity(session: ProofSession | null) {
  const seed = session?.uploaderKey ?? "feedfacec0de";
  const first = PROFILE_CALLSIGNS_A[seedNumber(seed, 2) % PROFILE_CALLSIGNS_A.length];
  const second = PROFILE_CALLSIGNS_B[seedNumber(seed, 10) % PROFILE_CALLSIGNS_B.length];
  const stamp = `${seed.slice(2, 5).toUpperCase()} ${seed.slice(5, 8).toUpperCase()}`;
  const handle = `${first}${second}_${seed.slice(8, 11)}`.toLowerCase();
  const pulseYear = session
    ? new Date(session.verifiedAt).getFullYear().toString().slice(-2)
    : "26";

  return {
    displayName: `${first} ${second}`,
    handle,
    stamp,
    credential:
      session?.verificationLevel === VerificationLevel.Orb
        ? "99.9% HUMAN / ORB VERIFIED"
        : "99.8% HUMAN / DEVICE VERIFIED",
    intro:
      session?.verificationLevel === VerificationLevel.Orb
        ? "Biological signal confirmed in the World Orb network."
        : "Trusted device signal confirmed through World verification.",
    pulseLine: `Verified biological pulse since '${pulseYear}.`,
    story:
      "Architecting the live feed one frame at a time. Real moments, synced traces, zero synthetic noise.",
  };
}

export function ProofCameraTemplate() {
  const [selectedProof, setSelectedProof] = useState<VerificationLevel>(
    VerificationLevel.Device,
  );
  const [proofSession, setProofSession] = useState<ProofSession | null>(null);
  const [photos, setPhotos] = useState<PhotoCard[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [trackingPhotoId, setTrackingPhotoId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"feed" | "capture" | "chain" | "user">("feed");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([
    "cyber-art",
    "humanity",
    "neon-nights",
  ]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PhotoCard[]>([]);
  const activeProofConfig = getProofConfig(selectedProof);
  const profileIdentity = createProfileIdentity(proofSession);
  const trackedPhotosCount = photos.filter(
    (photo) => photo.humanoProtocol,
  ).length;
  const filecoinPhotosCount = photos.filter((photo) => photo.filecoin).length;
  const hasAccess = Boolean(proofSession?.decision.allowCamera);
  const selectedPhoto =
    photos.find((photo) => photo.id === selectedPhotoId) ?? photos[0] ?? null;
  const recentFeedPhotos = photos.slice(0, 4);
  const vibeCards = [
    {
      id: "cyber-art",
      label: "Cyber Art",
      icon: "palette",
      tone: "bright" as const,
      subtitle: "Visual identity",
    },
    {
      id: "analog-sound",
      label: "Analog Sound",
      icon: "wave",
      tone: "dark" as const,
      subtitle: "Human frequencies",
    },
    {
      id: "humanity",
      label:
        proofSession?.verificationLevel === VerificationLevel.Orb
          ? "Humanity 100%"
          : "Humanity 99%",
      icon: "group",
      tone: "wide" as const,
      subtitle:
        proofSession?.verificationLevel === VerificationLevel.Orb
          ? "Orb-verified signal"
          : "Trusted device signal",
    },
    {
      id: "neon-nights",
      label: "Neon Nights",
      icon: "moon",
      tone: "bright" as const,
      subtitle: "After-dark pulse",
    },
    {
      id: "digital-rebels",
      label: "Digital Rebels",
      icon: "group",
      tone: "dark" as const,
      subtitle: `${photos.length} live moment${photos.length === 1 ? "" : "s"}`,
    },
    {
      id: "retro-tech",
      label: "Retro Tech",
      icon: "sliders",
      tone: "dark" as const,
      subtitle: `${filecoinPhotosCount} synced`,
    },
    {
      id: "voucher-network",
      label: "Voucher Network",
      icon: "cube",
      tone: "dark" as const,
      subtitle: `${trackedPhotosCount} proofs tracked`,
    },
  ];

  async function refreshGallery(focusedPhotoId?: string | null) {
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
      setSelectedPhotoId((current) => {
        const preferredId = focusedPhotoId ?? current;

        if (preferredId && nextPhotos.some((photo) => photo.id === preferredId)) {
          return preferredId;
        }

        return nextPhotos[0]?.id ?? null;
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
    const verifiedAt = new Date().toISOString();
    const bypassSession: ProofSession = {
      action: activeProofConfig.action,
      verificationLevel: selectedProof,
      verifiedAt,
      expiresAt: createSessionExpiry(verifiedAt),
      source: "dev-bypass",
      nullifierHash: null,
      merkleRoot: null,
      backgroundedAt: null,
      uploaderKey: deriveUploaderKey({
        source: "dev-bypass",
        action: activeProofConfig.action,
        verifiedAt,
      }),
      decision: createDefaultDecision(selectedProof, "dev-bypass"),
    };

    updateProofSession(bypassSession);
    setActiveTab("capture");
    setNotice(
      `${proofLabel(selectedProof)} unlocked with local dev bypass. This starts a temporary camera session for testing only.`,
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

      const { commandPayload, finalPayload } =
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
          commandPayload,
        }),
      });

      const verificationBody = (await verificationResponse.json()) as
        | {
            success: false;
            error?: string;
            errorCode?: string | null;
            errorDetail?: string | null;
            errorAttribute?: string | null;
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
            ? [
                verificationBody.error,
                verificationBody.errorDetail &&
                verificationBody.errorDetail !== verificationBody.error
                  ? verificationBody.errorDetail
                  : null,
                verificationBody.errorAttribute
                  ? `Field: ${verificationBody.errorAttribute}`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : undefined;

        setError(
          failureMessage ?? "World ID verification failed on the backend.",
        );
        return;
      }

      const verifiedAt = verificationBody.verifiedAt ?? new Date().toISOString();
      const verifiedSession: ProofSession = {
        action: verificationBody.proof.action,
        verificationLevel: verificationBody.proof.verificationLevel,
        verifiedAt,
        expiresAt: createSessionExpiry(verifiedAt),
        source: "world-id",
        signal: verificationBody.proof.signal,
        nullifierHash: verificationBody.proof.nullifierHash,
        merkleRoot: verificationBody.proof.merkleRoot,
        backgroundedAt: null,
        uploaderKey: deriveUploaderKey({
          source: "world-id",
          action: verificationBody.proof.action,
          verifiedAt,
          nullifierHash: verificationBody.proof.nullifierHash,
        }),
        decision: verificationBody.decision,
      };

      updateProofSession(verifiedSession);
      setActiveTab("capture");
      setNotice(
        `${verificationBody.decision.reason}`,
      );
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
        uploaderKey: proofSession.uploaderKey,
        blob,
      };

      await savePhoto(nextPhoto);
      await refreshGallery(nextPhoto.id);
      setSelectedPhotoId(nextPhoto.id);
      setActiveTab("feed");
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
      formData.append("uploaderKey", photo.uploaderKey ?? proofSession?.uploaderKey ?? "");

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
        humanoProtocol:
          responseBody.humanoProtocol as HumanoProtocolRecord | undefined,
      };

      await savePhoto(updatedPhoto);
      await refreshGallery();
      setNotice(
        responseBody.humanoProtocol
          ? `Photo uploaded to Filecoin and recorded on Humano Protocol. PieceCID: ${responseBody.filecoin.pieceCid}`
          : responseBody.humanoProtocolError
            ? `Photo uploaded to Filecoin, but Humano Protocol tracking failed: ${responseBody.humanoProtocolError}`
            : `Photo uploaded to Filecoin Calibration. PieceCID: ${responseBody.filecoin.pieceCid}`,
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

  function openQuickCapture() {
    quickCaptureInputRef.current?.click();
  }

  function openFeedTab() {
    setActiveTab("feed");
  }

  function openCaptureTab() {
    setActiveTab("capture");
  }

  function openChainTab() {
    setActiveTab("chain");
  }

  function openUserTab() {
    setActiveTab("user");
  }

  function openPhoto(photoId: string) {
    setSelectedPhotoId(photoId);
    setActiveTab("feed");
  }

  function toggleVibe(vibeId: string) {
    setSelectedVibes((current) =>
      current.includes(vibeId)
        ? current.filter((item) => item !== vibeId)
        : [...current, vibeId],
    );
  }

  async function handleRecordOnHumano(photo: StoredPhoto) {
    resetMessages();

    if (!photo.filecoin) {
      setError("Upload the photo to Filecoin before recording it on Humano.");
      return;
    }

    setTrackingPhotoId(photo.id);

    try {
      const response = await fetch("/api/humano/record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploaderKey: photo.uploaderKey,
          pieceCid: photo.filecoin.pieceCid,
          worldAction: photo.worldAction ?? "unknown-action",
          verificationLevel: photo.verificationLevel,
          createdAt: photo.createdAt,
          size: photo.filecoin.size,
          retrievalUrl: photo.filecoin.retrievalUrl,
        }),
      });

      const responseBody = (await response.json()) as HumanoProtocolRecordResponse;

      if (!response.ok || !responseBody.success) {
        const message =
          responseBody.success === false
            ? humanizeFilecoinError(responseBody.error)
            : "Humano Protocol tracking failed.";

        setError(message);
        return;
      }

      const updatedPhoto: StoredPhoto = {
        ...photo,
        humanoProtocol: responseBody.humanoProtocol,
      };

      await savePhoto(updatedPhoto);
      await refreshGallery();
      setNotice(
        `Photo recorded on Humano Protocol. Upload #${responseBody.humanoProtocol.uploadId}`,
      );
    } catch (recordError) {
      setError(humanizeError(recordError));
    } finally {
      setTrackingPhotoId(null);
    }
  }

  function handleResetProof() {
    resetMessages();
    stopCamera();
    updateProofSession(null);
    setSelectedProof(VerificationLevel.Device);
    setActiveTab("feed");
    setNotice("Local proof session reset.");
  }

  useEffect(() => {
    let checks = 0;
    let cancelled = false;

    const intervalId = window.setInterval(() => {
      const installed = MiniKit.isInstalled();
      checks += 1;

      if (installed || checks >= 20) {
        window.clearInterval(intervalId);
      }
    }, 250);

    const storedSession = loadStoredProofSession();
    const startupNotice = consumeSessionNotice();

    if (startupNotice) {
      setNotice(startupNotice);
    }

    if (storedSession) {
      setSelectedProof(storedSession.verificationLevel);
      const activeSession = createActiveSession(storedSession);
      setProofSession(activeSession);
      persistProofSession(activeSession);
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
        setSelectedPhotoId((current) => {
          if (current && nextPhotos.some((photo) => photo.id === current)) {
            return current;
          }

          return nextPhotos[0]?.id ?? null;
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
    if (!proofSession) {
      return;
    }

    function expireFromEffect(message: string) {
      stopActiveStream(streamRef, videoRef);
      setCameraReady(false);
      setCameraError(null);
      setActiveTab("feed");
      setProofSession(null);
      persistProofSession(null);
      setNotice(message);
    }

    function restoreActiveSession(session: ProofSession) {
      const activeSession = createActiveSession(session);
      setProofSession(activeSession);
      persistProofSession(activeSession);
    }

    const expiresInMs = Math.max(Date.parse(proofSession.expiresAt) - Date.now(), 0);
    const timeoutId = window.setTimeout(() => {
      expireFromEffect(
        "Your verification session timed out. Sign in with World ID again.",
      );
    }, expiresInMs);

    function handleVisibilityChange() {
      if (!proofSession) {
        return;
      }

      if (document.visibilityState === "hidden") {
        const backgroundedSession: ProofSession = {
          ...proofSession,
          backgroundedAt: new Date().toISOString(),
        };

        updateProofSession(backgroundedSession);
        return;
      }

      const storedSession = loadStoredProofSession();

      if (!storedSession) {
        expireFromEffect(
          consumeSessionNotice() ??
            "Your verification session expired. Sign in with World ID again.",
        );
        return;
      }

      restoreActiveSession(storedSession);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [proofSession]);

  useEffect(() => {
    return () => {
      stopActiveStream(streamRef, videoRef);
      revokePhotoUrls(photosRef.current);
    };
  }, []);

  if (!hasAccess) {
    return (
      <div className="login-shell">
        <header className="login-topbar">
          <div className="login-brand">
            <span className="login-brand-mark" />
            <div className="login-brand-copy">
              <span className="login-brand-text">HUMANO_PROTOCOL</span>
              <span className="login-brand-subtext">World ID gated camera feed</span>
            </div>
          </div>
        </header>

        <section className="login-panel">
          <div className="login-hero">
            <div className="login-eye-shell" aria-hidden="true">
              <div className="login-eye-core">
                <div className="login-eye-mark">
                  <span className="login-eye-ring" />
                </div>
              </div>
            </div>

            <div className="login-copy">
              <span className="login-kicker">Verified humans only</span>
              <h1>
                <span>Enter</span>
                <span>The Pulse</span>
              </h1>
              <p>Human identity verification required</p>
            </div>

            <div className="login-proof-pills">
              <button
                type="button"
                className={`login-proof-pill ${
                  selectedProof === VerificationLevel.Device ? "active" : ""
                }`}
                onClick={() => setSelectedProof(VerificationLevel.Device)}
              >
                Device proof
              </button>
              <button
                type="button"
                className={`login-proof-pill ${
                  selectedProof === VerificationLevel.Orb ? "active" : ""
                }`}
                onClick={() => setSelectedProof(VerificationLevel.Orb)}
              >
                Orb proof
              </button>
            </div>

            <button
              type="button"
              className="login-world-button"
              onClick={() => void handleVerify()}
              disabled={isVerifying}
            >
              <span className="login-world-icon" />
              <span className="login-world-copy">
                <strong>
                  {isVerifying ? "Verifying with World ID" : "Sign in with World ID"}
                </strong>
                <small>Unlock a short verified camera session</small>
              </span>
            </button>

            <p className="login-support-copy">
              World verification is the only way into this experience. Once verified,
              the camera, feed, and profile unlock for a short live session and
              reset shortly after you leave the mini app.
            </p>
          </div>
        </section>

        <div className="login-statusbar">
          <span>HUMAN_VERIFICATION_STANDBY</span>
          <span>LATENCY: 14MS</span>
          <span className="login-status-dot" />
        </div>

        <nav className="login-nav">
          <button type="button" className="login-nav-item active" aria-label="Login">
            <span className="login-nav-glyph login-nav-glyph-enter" />
          </button>
          <button type="button" className="login-nav-item" aria-label="Identity preview">
            <span className="login-nav-glyph login-nav-glyph-eye" />
          </button>
          <button type="button" className="login-nav-item" aria-label="Timed session">
            <span className="login-nav-glyph login-nav-glyph-clock" />
          </button>
          <button type="button" className="login-nav-item" aria-label="Settings">
            <span className="login-nav-glyph login-nav-glyph-gear" />
          </button>
        </nav>

        {notice || error ? (
          <div className={`mobile-toast ${error ? "mobile-toast-error" : ""}`}>
            {error ?? notice}
          </div>
        ) : null}
      </div>
    );
  }

  const unlockedSession = proofSession as ProofSession;

  return (
    <div className="kinetic-shell">
      <input
        ref={quickCaptureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={!proofSession || isSavingPhoto}
        onChange={(event) => void handleQuickCapture(event)}
      />

      <header className="kinetic-topbar kinetic-topbar-centered" id="hero-stage">
        <div className="brand-lockup">
          <span className="brand-mark">HUMANO</span>
          <span className="brand-sub">protocol</span>
        </div>
      </header>

      <div className="app-screen-shell">
        {activeTab === "feed" ? (
          <div className="app-screen-scroll">
            <section className="hero-stage">
              <div className="hero-pill">VERIFIED HUMANS ONLY</div>
              <div className="hero-copy">
                <h1>
                  THE <em>PULSE</em>
                </h1>
                <p>
                  Real people. Real moments. Photos unlock through World verification,
                  sync to Filecoin, and can be tracked onchain by Humano Protocol.
                </p>
              </div>

              <div className="hero-stats">
                <article className="hero-stat">
                  <strong>{proofLabel(unlockedSession.verificationLevel)}</strong>
                  <span>Unlocked {formatDate(unlockedSession.verifiedAt)}</span>
                </article>
                <article className="hero-stat">
                  <strong>{photos.length}</strong>
                  <span>Captured</span>
                </article>
                <article className="hero-stat">
                  <strong>{trackedPhotosCount}</strong>
                  <span>Tracked onchain</span>
                </article>
              </div>
            </section>

            {selectedPhoto ? (
              <section className="viewer-panel" id="viewer-panel">
                <div className="panel-head">
                  <div>
                    <span className="panel-kicker">Latest shot</span>
                    <h2>Review the capture</h2>
                  </div>
                  <div className="mini-indicators">
                    <span className="mini-indicator">
                      {proofLabel(selectedPhoto.verificationLevel)}
                    </span>
                  </div>
                </div>

                <div className="viewer-stage">
                  <div className="viewer-media">
                    <Image
                      src={selectedPhoto.previewUrl}
                      alt={`Captured ${formatDate(selectedPhoto.createdAt)}`}
                      width={1400}
                      height={1800}
                      sizes="100vw"
                      unoptimized
                    />
                  </div>

                  <div className="viewer-body">
                    <span className="feed-handle">
                      @{formatCompactHash(selectedPhoto.id).replaceAll(".", "")}
                    </span>
                    <span className="feed-caption">{formatDate(selectedPhoto.createdAt)}</span>

                    <div className="status-row">
                      <span className="pill pill-success">LOCAL</span>
                      <span
                        className={`pill ${
                          selectedPhoto.filecoin ? "pill-success" : "pill-muted"
                        }`}
                      >
                        {selectedPhoto.filecoin ? "FILECOIN" : "PENDING"}
                      </span>
                      <span
                        className={`pill ${
                          selectedPhoto.humanoProtocol ? "pill-success" : "pill-muted"
                        }`}
                      >
                        {selectedPhoto.humanoProtocol ? "HUMANO" : "OFFCHAIN"}
                      </span>
                    </div>

                    {selectedPhoto.filecoin ? (
                      <div className="feed-data">
                        <span className="mono-pill">
                          piece_cid: {formatCompactHash(selectedPhoto.filecoin.pieceCid)}
                        </span>
                        {selectedPhoto.humanoProtocol ? (
                          <span className="mono-pill">
                            humano_id: #{selectedPhoto.humanoProtocol.uploadId}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="feed-actions">
                      <button
                        type="button"
                        className="action-button action-button-primary"
                        onClick={() => void handleUploadToFilecoin(selectedPhoto)}
                        disabled={
                          uploadingPhotoId === selectedPhoto.id ||
                          selectedPhoto.filecoin?.status === "uploaded"
                        }
                      >
                        {selectedPhoto.filecoin?.status === "uploaded"
                          ? "SYNCED"
                          : uploadingPhotoId === selectedPhoto.id
                            ? "SYNCING"
                            : "SYNC TO FILECOIN"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => void handleRecordOnHumano(selectedPhoto)}
                        disabled={
                          !selectedPhoto.filecoin ||
                          Boolean(selectedPhoto.humanoProtocol) ||
                          trackingPhotoId === selectedPhoto.id
                        }
                      >
                        {selectedPhoto.humanoProtocol
                          ? "TRACKED"
                          : trackingPhotoId === selectedPhoto.id
                            ? "TRACKING"
                            : "TRACK ON HUMANO"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => void handleDeletePhoto(selectedPhoto.id)}
                      >
                        DROP SHOT
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="feed-panel-dark" id="feed-panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">Verified feed</span>
                  <h2>Captured pulse</h2>
                </div>
                <div className="action-strip action-strip-tight">
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => void refreshGallery()}
                  >
                    REFRESH
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => void handleClearLibrary()}
                    disabled={!photos.length}
                  >
                    CLEAR
                  </button>
                </div>
              </div>

              {isGalleryLoading ? (
                <div className="empty-feed">Loading the verified feed...</div>
              ) : recentFeedPhotos.length ? (
                <div className="feed-grid">
                  {recentFeedPhotos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      className={`feed-card ${selectedPhoto?.id === photo.id ? "selected" : ""}`}
                      onClick={() => openPhoto(photo.id)}
                    >
                      <div className="feed-card-media">
                        <Image
                          src={photo.previewUrl}
                          alt={`Captured ${formatDate(photo.createdAt)}`}
                          width={1200}
                          height={1400}
                          sizes="(max-width: 520px) 100vw, 50vw"
                          unoptimized
                        />
                      </div>
                      <div className="feed-card-body">
                        <span className="feed-handle">
                          @{formatCompactHash(photo.id).replaceAll(".", "")}
                        </span>
                        <span className="feed-metadata">
                          {proofLabel(photo.verificationLevel)}
                        </span>
                        <span className="feed-caption">{formatDate(photo.createdAt)}</span>
                        <span className="feed-caption">Tap to open shot</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-feed">
                  <strong>No pulse yet.</strong>
                  <span>
                    Verify the session, shoot a photo, then sync it through Filecoin
                    and Humano to light up this feed.
                  </span>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "capture" ? (
          <div className="app-screen-scroll">
            <section className="protocol-panel" id="capture-panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">Kinetic protocol</span>
                  <h2>Capture a verified moment</h2>
                </div>
                <div className="mini-indicators">
                  <span className="mini-indicator">{activeProofConfig.label}</span>
                  <span className="mini-indicator mono-pill">{activeProofConfig.action}</span>
                </div>
              </div>

              <div className="action-strip">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => void startCamera()}
                  disabled={!proofSession || cameraReady}
                >
                  START LIVE CAM
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={stopCamera}
                  disabled={!cameraReady}
                >
                  STOP CAM
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={handleResetProof}
                  disabled={!proofSession}
                >
                  RESET
                </button>
              </div>

              <div className="camera-panel-dark">
                <div className="panel-kicker">Live capture stage</div>
                <div className="camera-shell camera-shell-kinetic">
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
                      <div className="camera-placeholder kinetic-placeholder">
                        <strong>Session-locked camera stage</strong>
                        <span>
                          Use the buttons below to start the camera and capture a new
                          verified moment.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="action-strip action-strip-tight">
                  <button
                    type="button"
                    className="action-button action-button-primary"
                    onClick={() => void handleCaptureFrame()}
                    disabled={!cameraReady || isSavingPhoto}
                  >
                    {isSavingPhoto ? "SAVING..." : "CAPTURE FRAME"}
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={openQuickCapture}
                    disabled={!proofSession || isSavingPhoto}
                  >
                    QUICK CAPTURE
                  </button>
                </div>
                {cameraError ? <p className="micro-copy">{cameraError}</p> : null}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "chain" ? (
          <div className="app-screen-scroll">
            <section className="protocol-panel" id="chain-panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">Signal chain</span>
                  <h2>Verification stack</h2>
                </div>
                <div className="mini-indicators">
                  <span className="mini-indicator">
                    {trackedPhotosCount} tracked
                  </span>
                </div>
              </div>

              <div className="status-stack">
                <div className="signal-row">
                  <span className="signal-tag">WORLD</span>
                  <p>
                    One proof unlocks the session. After that, the same verified
                    user can capture multiple photos.
                  </p>
                </div>
                <div className="signal-row">
                  <span className="signal-tag">FILECOIN</span>
                  <p>
                    {filecoinPhotosCount
                      ? `${filecoinPhotosCount} captured moment${
                          filecoinPhotosCount === 1 ? "" : "s"
                        } are already synced to Filecoin Calibration.`
                      : "No captured moments have been pushed to Filecoin yet."}
                  </p>
                </div>
                <div className="signal-row">
                  <span className="signal-tag">HUMANO</span>
                  <p>
                    {trackedPhotosCount
                      ? `${trackedPhotosCount} capture${
                          trackedPhotosCount === 1 ? "" : "s"
                        } are recorded on Humano Protocol.`
                      : "No capture has been recorded on Humano Protocol yet."}
                  </p>
                </div>
              </div>

              <div className="hash-block">
                <span className="mini-indicator">CAMERA SESSION UNLOCKED</span>
                <p className="micro-copy">{unlockedSession.decision.reason}</p>
                <span className="mono-pill">
                  uploader_key: {formatCompactHash(unlockedSession.uploaderKey)}
                </span>
                {unlockedSession.nullifierHash ? (
                  <span className="mono-pill">
                    nullifier: {formatCompactHash(unlockedSession.nullifierHash)}
                  </span>
                ) : null}
                {selectedPhoto?.filecoin ? (
                  <span className="mono-pill">
                    piece_cid: {formatCompactHash(selectedPhoto.filecoin.pieceCid)}
                  </span>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "user" ? (
          <div className="app-screen-scroll">
            <section className="profile-panel" id="user-panel">
        <div className="social-topbar">
          <button
            type="button"
            className="icon-button"
            onClick={openFeedTab}
            aria-label="Open feed"
          >
            <span />
            <span />
            <span />
          </button>

          <div className="brand-lockup">
            <span className="brand-mark">PULSE</span>
          </div>

          <button
            type="button"
            className="social-skip"
            onClick={openCaptureTab}
          >
            @{profileIdentity.handle}
          </button>
        </div>

        <div className="social-profile-copy">
          <h2>PICK YOUR VIBE</h2>
          <p>
            Curate the social pulse around your verified identity. Pick the moods
            that best match how you want this profile to feel.
          </p>
        </div>

        <div className="social-vibe-grid">
          {vibeCards.slice(0, 2).map((card) => (
            <button
              key={card.id}
              type="button"
              className={`social-vibe-card social-vibe-card-${card.tone} ${
                selectedVibes.includes(card.id) ? "selected" : ""
              }`}
              onClick={() => toggleVibe(card.id)}
            >
              <span className={`social-vibe-icon social-vibe-icon-${card.icon}`} />
              <strong>{card.label}</strong>
            </button>
          ))}

          <article className="social-vibe-card social-vibe-card-wide">
            <div>
              <strong>{vibeCards[2]?.label}</strong>
              <span>{vibeCards[2]?.subtitle}</span>
            </div>
            <span className="social-vibe-icon social-vibe-icon-group" />
          </article>

          {vibeCards.slice(3, 5).map((card) => (
            <button
              key={card.id}
              type="button"
              className={`social-vibe-card social-vibe-card-${card.tone} ${
                selectedVibes.includes(card.id) ? "selected" : ""
              }`}
              onClick={() => toggleVibe(card.id)}
            >
              <span className={`social-vibe-icon social-vibe-icon-${card.icon}`} />
              <strong>{card.label}</strong>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="social-proof-banner"
          onClick={() => {
            if (selectedPhoto) {
              openPhoto(selectedPhoto.id);
            }
          }}
          style={
            selectedPhoto
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(12, 13, 18, 0.28), rgba(12, 13, 18, 0.9)), url(${selectedPhoto.previewUrl})`,
                }
              : undefined
          }
        >
          <span>Street proofs</span>
        </button>

        <div className="social-vibe-grid social-vibe-grid-bottom">
          {vibeCards.slice(5).map((card) => (
            <article
              key={card.id}
              className="social-vibe-card social-vibe-card-dark social-vibe-card-detail"
            >
              <span className={`social-vibe-icon social-vibe-icon-${card.icon}`} />
              <strong>{card.label}</strong>
              <span>{card.subtitle}</span>
            </article>
          ))}
        </div>

        <button type="button" className="social-profile-cta" onClick={openFeedTab}>
          INITIATE FEED
        </button>
            </section>
          </div>
        ) : null}
      </div>

      <nav className="bottom-nav">
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "feed" ? "active" : ""}`}
          onClick={openFeedTab}
        >
          <span className="bottom-nav-icon bottom-nav-icon-feed" />
          <span className="bottom-nav-label">Feed</span>
        </button>
        <button
          type="button"
          className="bottom-nav-item"
          onClick={openFeedTab}
        >
          <span className="bottom-nav-icon bottom-nav-icon-discover" />
          <span className="bottom-nav-label">Explore</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item bottom-nav-item-capture ${
            activeTab === "capture" ? "emphasis" : ""
          }`}
          onClick={openCaptureTab}
        >
          <span className="bottom-nav-capture-badge">
            <span className="bottom-nav-icon bottom-nav-icon-capture" />
          </span>
          <span className="bottom-nav-label">Capture</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "chain" ? "active" : ""}`}
          onClick={openChainTab}
        >
          <span className="bottom-nav-icon bottom-nav-icon-chain" />
          <span className="bottom-nav-label">Chain</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "user" ? "active" : ""}`}
          onClick={openUserTab}
        >
          <span className="bottom-nav-icon bottom-nav-icon-user" />
          <span className="bottom-nav-label">User</span>
        </button>
      </nav>

      {notice || error ? (
        <div className={`mobile-toast ${error ? "mobile-toast-error" : ""}`}>
          {error ?? notice}
        </div>
      ) : null}
    </div>
  );
}
