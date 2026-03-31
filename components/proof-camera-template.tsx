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
  source: ProofSource;
  signal?: string;
  nullifierHash?: string | null;
  merkleRoot?: string | null;
  uploaderKey: string;
  decision: ProofDecision;
}

interface PhotoCard extends StoredPhoto {
  previewUrl: string;
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

export function ProofCameraTemplate() {
  const [selectedProof, setSelectedProof] = useState<VerificationLevel>(
    VerificationLevel.Device,
  );
  const [proofSession, setProofSession] = useState<ProofSession | null>(null);
  const [photos, setPhotos] = useState<PhotoCard[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isGalleryLoading, setIsGalleryLoading] = useState(true);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [trackingPhotoId, setTrackingPhotoId] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"feed" | "capture" | "chain" | "user">("feed");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<PhotoCard[]>([]);
  const activeProofConfig = getProofConfig(selectedProof);
  const trackedPhotosCount = photos.filter(
    (photo) => photo.humanoProtocol,
  ).length;

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
    const verifiedAt = new Date().toISOString();
    const bypassSession: ProofSession = {
      action: activeProofConfig.action,
      verificationLevel: selectedProof,
      verifiedAt,
      source: "dev-bypass",
      nullifierHash: null,
      merkleRoot: null,
      uploaderKey: deriveUploaderKey({
        source: "dev-bypass",
        action: activeProofConfig.action,
        verifiedAt,
      }),
      decision: createDefaultDecision(selectedProof, "dev-bypass"),
    };

    updateProofSession(bypassSession);
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
        source: "world-id",
        signal: verificationBody.proof.signal,
        nullifierHash: verificationBody.proof.nullifierHash,
        merkleRoot: verificationBody.proof.merkleRoot,
        uploaderKey: deriveUploaderKey({
          source: "world-id",
          action: verificationBody.proof.action,
          verifiedAt,
          nullifierHash: verificationBody.proof.nullifierHash,
        }),
        decision: verificationBody.decision,
      };

      updateProofSession(verifiedSession);
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

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function openFeedTab() {
    setActiveTab("feed");
    scrollToSection("feed-panel");
  }

  function openCaptureTab() {
    setActiveTab("capture");
    scrollToSection("capture-panel");
  }

  function openChainTab() {
    setActiveTab("chain");
    scrollToSection("capture-panel");
  }

  function openUserTab() {
    setActiveTab("user");
    scrollToSection("hero-stage");
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

      <header className="kinetic-topbar" id="hero-stage">
        <button
          type="button"
          className="icon-button"
          aria-label="Open feed"
          onClick={openFeedTab}
        >
          <span />
          <span />
          <span />
        </button>

        <div className="brand-lockup">
          <span className="brand-mark">HUMANO</span>
          <span className="brand-sub">protocol</span>
        </div>

        <button
          type="button"
          className="icon-button"
          aria-label="Open capture"
          onClick={openCaptureTab}
        >
          <span className="icon-ring" />
        </button>
      </header>

      <div className="status-ticker">
        <span className="status-dot" />
        <span>
          {proofSession?.decision.allowCamera
            ? "LIVE VERIFICATION SESSION ACTIVE"
            : "LIVE VERIFICATION STANDBY"}
        </span>
      </div>

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
            <strong>
              {proofSession?.decision.allowCamera
                ? proofLabel(proofSession.verificationLevel)
                : "Locked"}
            </strong>
            <span>
              {proofSession
                ? `Unlocked ${formatDate(proofSession.verifiedAt)}`
                : "Verify to unlock session"}
            </span>
          </article>
          <article className="hero-stat">
            <strong>{photos.length}</strong>
            <span>{photos.length === 1 ? "Captured" : "Captured"}</span>
          </article>
          <article className="hero-stat">
            <strong>{trackedPhotosCount}</strong>
            <span>Tracked onchain</span>
          </article>
        </div>
      </section>

      {notice ? <div className="signal-banner signal-banner-good">{notice}</div> : null}
      {error ? <div className="signal-banner signal-banner-bad">{error}</div> : null}

      <section className="protocol-panel" id="capture-panel">
        <div className="panel-head">
          <div>
            <span className="panel-kicker">Kinetic protocol</span>
            <h2>Unlock the feed</h2>
          </div>
          <div className="mini-indicators">
            <span className="mini-indicator">{activeProofConfig.label}</span>
            <span className="mini-indicator mono-pill">{activeProofConfig.action}</span>
          </div>
        </div>

        <div className="proof-mode-grid">
          <button
            type="button"
            className={`mode-card ${
              selectedProof === VerificationLevel.Device ? "active" : ""
            }`}
            onClick={() => setSelectedProof(VerificationLevel.Device)}
          >
            <span className="mode-label">Device proof</span>
            <strong>Fast unlock</strong>
            <p>Best for low-friction camera sessions inside World App.</p>
          </button>
          <button
            type="button"
            className={`mode-card ${
              selectedProof === VerificationLevel.Orb ? "active" : ""
            }`}
            onClick={() => setSelectedProof(VerificationLevel.Orb)}
          >
            <span className="mode-label">Orb proof</span>
            <strong>Humanity first</strong>
            <p>Higher-assurance proof for strict anti-bot, anti-Sybil flows.</p>
          </button>
        </div>

        <div className="action-strip">
          <button
            type="button"
            className="action-button action-button-primary"
            onClick={() => void handleVerify()}
            disabled={isVerifying}
          >
            {isVerifying ? "VERIFYING..." : "VERIFY SESSION"}
          </button>
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

        <div className="protocol-grid">
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
                      Verify first, then use live preview or quick capture to
                      populate the feed.
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

          <div className="camera-panel-dark">
            <div className="panel-kicker">Signal chain</div>
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
                  Image bytes can be synced to Filecoin Calibration and returned
                  with a real PieceCID.
                </p>
              </div>
              <div className="signal-row">
                <span className="signal-tag">HUMANO</span>
                <p>
                  Each Filecoin-backed upload can be recorded onchain under the
                  humano_protocol contract.
                </p>
              </div>
            </div>

            {proofSession ? (
              <div className="hash-block">
                <span className="mini-indicator">
                  {proofSession.decision.allowCamera
                    ? "CAMERA SESSION UNLOCKED"
                    : "CAMERA BLOCKED"}
                </span>
                <p className="micro-copy">{proofSession.decision.reason}</p>
                <span className="mono-pill">
                  uploader_key: {formatCompactHash(proofSession.uploaderKey)}
                </span>
                {proofSession.nullifierHash ? (
                  <span className="mono-pill">
                    nullifier: {formatCompactHash(proofSession.nullifierHash)}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="hash-block">
                <span className="mini-indicator">WAITING FOR VERIFICATION</span>
                <p className="micro-copy">
                  {isDevBypassEnabled()
                    ? "Browser preview can still unlock with dev bypass while you wire real World credentials."
                    : "Open inside World App to unlock the session for real."}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

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
        ) : photos.length ? (
          <div className="feed-grid">
            {photos.map((photo) => (
              <article key={photo.id} className="feed-card">
                <div className="feed-card-media">
                  <Image
                    src={photo.previewUrl}
                    alt={`Captured ${formatDate(photo.createdAt)}`}
                    width={1200}
                    height={1400}
                    sizes="(max-width: 520px) 50vw, 33vw"
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

                  <div className="status-row">
                    <span className="pill pill-success">LOCAL</span>
                    <span
                      className={`pill ${
                        photo.filecoin ? "pill-success" : "pill-muted"
                      }`}
                    >
                      {photo.filecoin ? "FILECOIN" : "PENDING"}
                    </span>
                    <span
                      className={`pill ${
                        photo.humanoProtocol ? "pill-success" : "pill-muted"
                      }`}
                    >
                      {photo.humanoProtocol ? "HUMANO" : "OFFCHAIN"}
                    </span>
                  </div>

                  {photo.filecoin ? (
                    <div className="feed-data">
                      <span className="mono-pill">
                        piece_cid: {formatCompactHash(photo.filecoin.pieceCid)}
                      </span>
                      {photo.humanoProtocol ? (
                        <span className="mono-pill">
                          humano_id: #{photo.humanoProtocol.uploadId}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="feed-actions">
                    <button
                      type="button"
                      className="action-button action-button-primary"
                      onClick={() => void handleUploadToFilecoin(photo)}
                      disabled={
                        uploadingPhotoId === photo.id ||
                        photo.filecoin?.status === "uploaded"
                      }
                    >
                      {photo.filecoin?.status === "uploaded"
                        ? "SYNCED"
                        : uploadingPhotoId === photo.id
                          ? "SYNCING"
                          : "SYNC"}
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleRecordOnHumano(photo)}
                      disabled={
                        !photo.filecoin ||
                        Boolean(photo.humanoProtocol) ||
                        trackingPhotoId === photo.id
                      }
                    >
                      {photo.humanoProtocol
                        ? "TRACKED"
                        : trackingPhotoId === photo.id
                          ? "TRACKING"
                          : "TRACK"}
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleDeletePhoto(photo.id)}
                    >
                      DROP
                    </button>
                  </div>
                </div>
              </article>
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

      <button
        type="button"
        className="camera-fab"
        onClick={() => {
          setActiveTab("capture");
          openQuickCapture();
        }}
        disabled={!proofSession || isSavingPhoto}
        aria-label="Quick capture"
      >
        <span className="camera-fab-core" />
      </button>

      <nav className="bottom-nav">
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "feed" ? "active" : ""}`}
          onClick={openFeedTab}
        >
          FEED
        </button>
        <button
          type="button"
          className="bottom-nav-item"
          onClick={openFeedTab}
        >
          EXPLORE
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "capture" ? "emphasis" : ""}`}
          onClick={openCaptureTab}
        >
          CAPTURE
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "chain" ? "active" : ""}`}
          onClick={openChainTab}
        >
          CHAIN
        </button>
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === "user" ? "active" : ""}`}
          onClick={openUserTab}
        >
          USER
        </button>
      </nav>
    </div>
  );
}
