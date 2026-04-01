"use client";

import Image from "next/image";
import { keccak256, stringToHex } from "viem";
import {
  type ChangeEvent,
  type MutableRefObject,
  useCallback,
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
import type {
  ProfileMetadataResponse,
  ProfileMetadataSnapshot,
} from "@/lib/metadata";
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
const PROOF_INTERESTS_KEY = "proofcam-interest-profile";
const PROOF_SESSION_TTL_MS = 15 * 60 * 1000;
const PROOF_SESSION_BACKGROUND_GRACE_MS = 75 * 1000;

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

function loadStoredInterests() {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(PROOF_INTERESTS_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(PROOF_INTERESTS_KEY);
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    window.localStorage.removeItem(PROOF_INTERESTS_KEY);
    return [];
  }
}

function persistInterests(interests: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROOF_INTERESTS_KEY, JSON.stringify(interests));
}

function revokePhotoUrls(photos: PhotoCard[]) {
  for (const photo of photos) {
    URL.revokeObjectURL(photo.previewUrl);
  }
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
  const [activeTab, setActiveTab] = useState<"feed" | "explore" | "chain" | "user">("feed");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [metadataSnapshot, setMetadataSnapshot] =
    useState<ProfileMetadataSnapshot | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    displayName: "",
    handle: "",
    bio: "",
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PhotoCard[]>([]);
  const selectedVibesRef = useRef<string[]>([]);
  const activeProofConfig = getProofConfig(selectedProof);
  const localTrackedPhotosCount = photos.filter(
    (photo) => photo.humanoProtocol,
  ).length;
  const localFilecoinPhotosCount = photos.filter((photo) => photo.filecoin).length;
  const trackedPhotosCount = Math.max(
    metadataSnapshot?.stats.humanoCount ?? 0,
    localTrackedPhotosCount,
  );
  const filecoinPhotosCount = Math.max(
    metadataSnapshot?.stats.filecoinCount ?? 0,
    localFilecoinPhotosCount,
  );
  const photoCount = Math.max(metadataSnapshot?.stats.photoCount ?? 0, photos.length);
  const hasAccess = Boolean(proofSession?.decision.allowCamera);
  const hasCompletedInterests = selectedVibes.length >= 3;
  const savedProfile = metadataSnapshot?.profile ?? {
    displayName: "",
    handle: "",
    bio: "",
  };
  const selectedPhoto =
    photos.find((photo) => photo.id === selectedPhotoId) ?? photos[0] ?? null;
  const recentFeedPhotos = photos.slice(0, 3);
  const profileHasDetails = Boolean(
    savedProfile.displayName.trim() ||
      savedProfile.handle.trim() ||
      savedProfile.bio.trim(),
  );
  const profileInitials =
    savedProfile.displayName
      .split(" ")
      .map((part) => part.trim()[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "HP";
  const vibeCards = [
    {
      id: "travel",
      label: "Travel",
      icon: "palette",
      tone: "bright" as const,
      subtitle: "Places and movement",
    },
    {
      id: "foodie",
      label: "Foodie",
      icon: "wave",
      tone: "dark" as const,
      subtitle: "Taste and culture",
    },
    {
      id: "street",
      label: "Street",
      icon: "group",
      tone: "wide" as const,
      subtitle: "Raw human moments",
    },
    {
      id: "music",
      label: "Music",
      icon: "moon",
      tone: "bright" as const,
      subtitle: "Sound and gigs",
    },
    {
      id: "art",
      label: "Art",
      icon: "group",
      tone: "dark" as const,
      subtitle: "Visual culture",
    },
    {
      id: "wellness",
      label: "Wellness",
      icon: "sliders",
      tone: "dark" as const,
      subtitle: "Mind and balance",
    },
    {
      id: "nightlife",
      label: "Nightlife",
      icon: "cube",
      tone: "dark" as const,
      subtitle: "After-dark energy",
    },
    {
      id: "tech",
      label: "Tech",
      icon: "sliders",
      tone: "dark" as const,
      subtitle: "Devices and builds",
    },
  ];
  const selectedInterestCards = vibeCards.filter((card) =>
    selectedVibes.includes(card.id),
  );

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

  const applyMetadataSnapshot = useCallback((snapshot: ProfileMetadataSnapshot) => {
    setMetadataSnapshot(snapshot);
    setSelectedVibes(snapshot.interests);
    persistInterests(snapshot.interests);
    setProfileDraft({
      displayName: snapshot.profile.displayName,
      handle: snapshot.profile.handle,
      bio: snapshot.profile.bio,
    });
  }, []);

  const syncMetadataBootstrap = useCallback(async (
    session: ProofSession,
    fallbackInterests: string[],
  ) => {
    try {
      const response = await fetch("/api/profile/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploaderKey: session.uploaderKey,
          verificationLevel: session.verificationLevel,
          action: session.action,
          source: session.source,
          verifiedAt: session.verifiedAt,
          nullifierHash: session.nullifierHash ?? null,
          merkleRoot: session.merkleRoot ?? null,
          interests: fallbackInterests,
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Profile bootstrap failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      return responseBody.snapshot;
    } catch (syncError) {
      console.error("Profile bootstrap sync failed.", syncError);
      return null;
    }
  }, [applyMetadataSnapshot]);

  async function syncInterestsMetadata(interests: string[]) {
    if (!proofSession) {
      return null;
    }

    try {
      const response = await fetch("/api/profile/interests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploaderKey: proofSession.uploaderKey,
          interests,
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Interest sync failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      return responseBody.snapshot;
    } catch (syncError) {
      console.error("Interest sync failed.", syncError);
      return null;
    }
  }

  async function syncProfileDetails() {
    if (!proofSession) {
      return null;
    }

    const nextDisplayName = profileDraft.displayName.trim();
    const nextHandle = profileDraft.handle.trim().replace(/^@+/, "");
    const nextBio = profileDraft.bio.trim();

    if (!nextDisplayName && !nextHandle && !nextBio) {
      setError("Add at least a name, handle, or bio before saving your profile.");
      return null;
    }

    setIsSavingProfile(true);

    try {
      const response = await fetch("/api/profile/details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploaderKey: proofSession.uploaderKey,
          displayName: nextDisplayName,
          handle: nextHandle,
          bio: nextBio,
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Profile save failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      setNotice("Profile saved.");
      return responseBody.snapshot;
    } catch (syncError) {
      setError(humanizeError(syncError));
      return null;
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function syncPhotoMetadata(photo: StoredPhoto) {
    try {
      const response = await fetch("/api/photos/metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          photoId: photo.id,
          uploaderKey: photo.uploaderKey,
          createdAt: photo.createdAt,
          mimeType: photo.mimeType,
          verificationLevel: photo.verificationLevel,
          worldAction: photo.worldAction ?? "unknown-action",
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Photo metadata sync failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      return responseBody.snapshot;
    } catch (syncError) {
      console.error("Photo metadata sync failed.", syncError);
      return null;
    }
  }

  async function syncDeletedPhotoMetadata(photoId: string, uploaderKey: string) {
    try {
      const response = await fetch("/api/photos/metadata", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          photoId,
          uploaderKey,
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Photo deletion sync failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      return responseBody.snapshot;
    } catch (syncError) {
      console.error("Photo deletion sync failed.", syncError);
      return null;
    }
  }

  async function syncClearedLibraryMetadata(uploaderKey: string) {
    try {
      const response = await fetch("/api/photos/metadata", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploaderKey,
        }),
      });

      const responseBody = (await response.json()) as ProfileMetadataResponse;

      if (!response.ok || !responseBody.success) {
        throw new Error(
          responseBody.success === false
            ? responseBody.error
            : "Library clear sync failed.",
        );
      }

      applyMetadataSnapshot(responseBody.snapshot);
      return responseBody.snapshot;
    } catch (syncError) {
      console.error("Library clear sync failed.", syncError);
      return null;
    }
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
    const snapshot = await syncMetadataBootstrap(bypassSession, selectedVibes);
    const nextInterestsCount = snapshot?.interests.length ?? selectedVibes.length;
    setActiveTab(nextInterestsCount >= 3 ? "feed" : "explore");
    setNotice("Dev bypass active.");
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
      const snapshot = await syncMetadataBootstrap(verifiedSession, selectedVibes);
      const nextInterestsCount = snapshot?.interests.length ?? selectedVibes.length;
      setActiveTab(nextInterestsCount >= 3 ? "feed" : "explore");
      setNotice("Verified. Camera unlocked.");
    } catch (verifyError) {
      setError(humanizeError(verifyError));
    } finally {
      setIsVerifying(false);
    }
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
      void syncPhotoMetadata(nextPhoto);
      await refreshGallery(nextPhoto.id);
      setSelectedPhotoId(nextPhoto.id);
      setActiveTab("feed");
      setNotice("Photo saved.");
    } catch (photoError) {
      setError(humanizeError(photoError));
    } finally {
      setIsSavingPhoto(false);
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
      const targetPhoto = photos.find((photo) => photo.id === id);

      await deletePhoto(id);
      if (targetPhoto?.uploaderKey) {
        void syncDeletedPhotoMetadata(id, targetPhoto.uploaderKey);
      }
      await refreshGallery();
      setNotice("Photo removed.");
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
      formData.append("photoId", photo.id);

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
          ? "Synced to Filecoin and tracked on Humano."
          : responseBody.humanoProtocolError
            ? `Filecoin synced, Humano failed: ${responseBody.humanoProtocolError}`
            : responseBody.metadataError
              ? `Synced to Filecoin. Metadata warning: ${responseBody.metadataError}`
              : "Synced to Filecoin.",
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
      if (proofSession?.uploaderKey) {
        void syncClearedLibraryMetadata(proofSession.uploaderKey);
      }
      await refreshGallery();
      setNotice("Library cleared.");
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

  function openExploreTab() {
    setActiveTab("explore");
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

  function openCaptureAction() {
    resetMessages();

    if (!proofSession) {
      setError("Sign in with World ID first.");
      return;
    }

    if (!hasCompletedInterests) {
      setActiveTab("explore");
      setError("Pick at least 3 interests first so the feed can be personalized.");
      return;
    }

    openQuickCapture();
  }

  function toggleVibe(vibeId: string) {
    setSelectedVibes((current) => {
      const nextSelection = current.includes(vibeId)
        ? current.filter((item) => item !== vibeId)
        : [...current, vibeId];

      persistInterests(nextSelection);
      return nextSelection;
    });
  }

  function handleCompleteInterests() {
    if (selectedVibes.length < 3) {
      setError("Pick at least 3 interests to shape the feed.");
      return;
    }

    persistInterests(selectedVibes);
    void syncInterestsMetadata(selectedVibes);
    setActiveTab("feed");
    setNotice("Interests saved.");
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
          photoId: photo.id,
          uploaderKey: photo.uploaderKey,
          pieceCid: photo.filecoin.pieceCid,
          worldAction: photo.worldAction ?? "unknown-action",
          verificationLevel: photo.verificationLevel,
          createdAt: photo.createdAt,
          mimeType: photo.mimeType,
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
        responseBody.metadataError
          ? `Tracked on Humano. Metadata warning: ${responseBody.metadataError}`
          : "Tracked on Humano.",
      );
    } catch (recordError) {
      setError(humanizeError(recordError));
    } finally {
      setTrackingPhotoId(null);
    }
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
    const storedInterests = loadStoredInterests();
    const startupNotice = consumeSessionNotice();

    if (startupNotice) {
      setNotice(startupNotice);
    }

    if (storedInterests.length) {
      setSelectedVibes(storedInterests);
    }

    if (storedSession) {
      setSelectedProof(storedSession.verificationLevel);
      const activeSession = createActiveSession(storedSession);
      setProofSession(activeSession);
      persistProofSession(activeSession);
      setActiveTab(storedInterests.length >= 3 ? "feed" : "explore");
      void syncMetadataBootstrap(activeSession, storedInterests).then((snapshot) => {
        if (!snapshot) {
          return;
        }

        setActiveTab(snapshot.interests.length >= 3 ? "feed" : "explore");
      });
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
  }, [syncMetadataBootstrap]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    selectedVibesRef.current = selectedVibes;
  }, [selectedVibes]);

  useEffect(() => {
    if (!notice && !error) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        if (error) {
          setError(null);
          return;
        }

        setNotice(null);
      },
      error ? 4200 : 2600,
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice, error]);

  useEffect(() => {
    if (!proofSession) {
      return;
    }

    function expireFromEffect(message: string) {
      stopActiveStream(streamRef, videoRef);
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
      void syncMetadataBootstrap(storedSession, selectedVibesRef.current);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [proofSession, syncMetadataBootstrap]);

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
            <span className="login-brand-text">HUMANO</span>
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
            <section className="viewer-panel viewer-panel-single" id="viewer-panel">
              {selectedPhoto ? (
                <>
                  <div className="panel-head">
                    <div>
                      <span className="panel-kicker">Verified feed</span>
                      <h2>Captured pulse</h2>
                      <p className="viewer-subcopy">
                        Real moments from your verified camera flow, ready for sync and tracking.
                      </p>
                    </div>
                    <div className="mini-indicators">
                      <span className="mini-indicator">{proofLabel(unlockedSession.verificationLevel)}</span>
                      <span className="mini-indicator">{photoCount} shot{photoCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>

                  <div className="viewer-stage viewer-stage-compact">
                    <div className="viewer-media viewer-media-compact">
                      <Image
                        src={selectedPhoto.previewUrl}
                        alt={`Captured ${formatDate(selectedPhoto.createdAt)}`}
                        width={1200}
                        height={1200}
                        sizes="100vw"
                        unoptimized
                      />
                    </div>

                    <div className="viewer-body viewer-body-compact">
                      <div className="viewer-meta-row">
                        <span className="feed-handle">
                          @{formatCompactHash(selectedPhoto.id).replaceAll(".", "")}
                        </span>
                        <span className="feed-caption">{formatDate(selectedPhoto.createdAt)}</span>
                      </div>

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

                      <div className="feed-actions feed-actions-compact">
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
                              : "SYNC"}
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
                              : "TRACK"}
                        </button>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => void handleDeletePhoto(selectedPhoto.id)}
                        >
                          DROP
                        </button>
                      </div>

                      {recentFeedPhotos.length > 1 ? (
                        <div className="feed-thumb-row">
                          {recentFeedPhotos.map((photo) => (
                            <button
                              key={photo.id}
                              type="button"
                              className={`feed-thumb ${selectedPhoto.id === photo.id ? "selected" : ""}`}
                              onClick={() => openPhoto(photo.id)}
                            >
                              <Image
                                src={photo.previewUrl}
                                alt={`Captured ${formatDate(photo.createdAt)}`}
                                width={320}
                                height={320}
                                unoptimized
                              />
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="action-strip action-strip-tight viewer-utility-row">
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
                  </div>
                </>
              ) : isGalleryLoading ? (
                <div className="empty-feed">Loading the verified feed...</div>
              ) : (
                <div className="empty-feed">
                  <strong>No posts yet.</strong>
                  <span>Use the center camera button to capture your first verified moment.</span>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "explore" ? (
          <div className="app-screen-scroll">
            <section className="profile-panel" id="explore-panel">
              {!hasCompletedInterests ? (
                <>
                  <div className="panel-head">
                    <div>
                      <span className="panel-kicker">First-time setup</span>
                      <h2>Pick your interests</h2>
                    </div>
                    <div className="mini-indicators">
                      <span className="mini-indicator">{selectedVibes.length} selected</span>
                    </div>
                  </div>

                  <p className="access-lede">
                    Choose at least 3 interests before you start posting.
                  </p>

                  <div className="social-vibe-grid social-vibe-grid-compact">
                    {vibeCards.map((card) => (
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
                        <span>{card.subtitle}</span>
                      </button>
                    ))}
                  </div>

                  <div className="action-strip">
                    <button
                      type="button"
                      className="action-button action-button-primary"
                      onClick={handleCompleteInterests}
                    >
                      Save interests
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="panel-head">
                    <div>
                      <span className="panel-kicker">Saved interests</span>
                      <h2>Your feed inputs</h2>
                    </div>
                    <div className="mini-indicators">
                      <span className="mini-indicator">{selectedInterestCards.length} saved</span>
                    </div>
                  </div>

                  <p className="access-lede">
                    These interests are already saved and shaping what appears in your feed.
                  </p>

                  <div className="profile-interest-row profile-interest-row-centered">
                    {selectedInterestCards.map((card) => (
                      <span key={card.id} className="profile-interest-chip">
                        {card.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "chain" ? (
          <div className="app-screen-scroll">
            <section className="protocol-panel" id="chain-panel">
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">Signal chain</span>
                  <h2>Proof pipeline</h2>
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
                <span className="mini-indicator">SESSION</span>
                <p className="micro-copy">
                  {proofLabel(unlockedSession.verificationLevel)} unlocked on{" "}
                  {formatDate(unlockedSession.verifiedAt)}.
                </p>
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
              <div className="profile-hero">
                <div className="profile-avatar-wrap">
                  <div className="profile-avatar-ring">
                    {selectedPhoto ? (
                      <Image
                        src={selectedPhoto.previewUrl}
                        alt="Profile avatar"
                        width={256}
                        height={256}
                        className="profile-avatar-image"
                        unoptimized
                      />
                    ) : (
                      <div className="profile-avatar-fallback">
                        {profileInitials}
                      </div>
                    )}
                  </div>
                </div>

                <span className="profile-credential-pill">
                  {unlockedSession.verificationLevel === VerificationLevel.Orb
                    ? "Orb verified"
                    : "Device verified"}
                </span>
                <div>
                  <h2 className="profile-display-name">
                    {savedProfile.displayName || "Add your profile"}
                  </h2>
                  <div className="profile-handle">
                    {savedProfile.handle ? `@${savedProfile.handle}` : "Add a handle"}
                  </div>
                </div>

                <div className="profile-bio profile-bio-centered">
                  {savedProfile.bio ? (
                    <p>{savedProfile.bio}</p>
                  ) : (
                    <p>Write a short bio so your profile feels like yours.</p>
                  )}
                </div>
              </div>

              <div className="profile-stat-row">
                <span className="profile-stat-pill">{photoCount} posts</span>
                <span className="profile-stat-pill">{selectedInterestCards.length} interests</span>
                <span className="profile-stat-pill">{trackedPhotosCount} proofs</span>
              </div>

              <p className="profile-meta-note">
                {selectedInterestCards.length
                  ? `${selectedInterestCards.length} interests are saved in your feed profile.`
                  : "No interests saved yet."}
              </p>

              <div className="profile-section-head">
                <h3>Profile details</h3>
              </div>

              <div className="profile-form">
                <label className="profile-field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={profileDraft.displayName}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder="Your name"
                    maxLength={40}
                  />
                </label>
                <label className="profile-field">
                  <span>Handle</span>
                  <input
                    type="text"
                    value={profileDraft.handle}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        handle: event.target.value.replace(/\s+/g, ""),
                      }))
                    }
                    placeholder="yourhandle"
                    maxLength={30}
                  />
                </label>
                <label className="profile-field">
                  <span>Bio</span>
                  <textarea
                    value={profileDraft.bio}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        bio: event.target.value,
                      }))
                    }
                    placeholder="Write a short bio"
                    rows={3}
                    maxLength={180}
                  />
                </label>
                <button
                  type="button"
                  className="action-button action-button-primary profile-save-button"
                  onClick={() => void syncProfileDetails()}
                  disabled={isSavingProfile}
                >
                  {isSavingProfile ? "Saving..." : profileHasDetails ? "Update profile" : "Save profile"}
                </button>
              </div>

              <div className="profile-section-head">
                <h3>Recent shots</h3>
              </div>

              {photos.length ? (
                <div className="profile-history-stage profile-history-stage-compact">
                  <div className="profile-history-grid">
                    {photos.slice(0, 3).map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className="profile-thumb-card"
                        onClick={() => openPhoto(photo.id)}
                      >
                        <Image
                          src={photo.previewUrl}
                          alt={`Shot ${formatDate(photo.createdAt)}`}
                          width={720}
                          height={720}
                          className="profile-thumb-image"
                          unoptimized
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="profile-empty-state">
                  <strong>No posts yet.</strong>
                  <span>Use the center camera button to capture your first verified moment.</span>
                </div>
              )}
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
          className={`bottom-nav-item ${activeTab === "explore" ? "active" : ""}`}
          onClick={openExploreTab}
        >
          <span className="bottom-nav-icon bottom-nav-icon-discover" />
          <span className="bottom-nav-label">Explore</span>
        </button>
        <button
          type="button"
          className="bottom-nav-item bottom-nav-item-capture emphasis"
          onClick={openCaptureAction}
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
