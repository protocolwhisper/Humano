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
    <div className="app-frame">
      <section className="card hero-card">
        <div className="eyebrow-row">
          <span className="pill pill-strong">World Mini App template</span>
          <span
            className={`pill ${
              isWorldAppReady ? "pill-success" : "pill-muted"
            }`}
          >
            {isWorldAppReady
              ? "World App detected"
              : isCheckingWorldApp
                ? "Checking World App"
                : "Browser preview mode"}
          </span>
        </div>

        <h1>Proof-gated camera flow for a World App mini app.</h1>
        <p>
          Device proof is the default for lower friction, Orb human proof is
          available when you need stronger personhood, and every captured photo
          stays stored locally inside the app on the current device.
        </p>

        <div className="stats-grid">
          <div className="stat-chip">
            <strong>
              {proofSession?.decision.allowCamera
                ? proofLabel(proofSession.verificationLevel)
                : "Locked"}
            </strong>
            <span>
              {proofSession
                ? `Unlocked ${formatDate(proofSession.verifiedAt)}`
                : "Verify to unlock camera access"}
            </span>
          </div>

          <div className="stat-chip">
            <strong>{photos.length}</strong>
            <span>{photos.length === 1 ? "Saved photo" : "Saved photos"}</span>
          </div>
        </div>
      </section>

      {notice ? <div className="notice notice-success">{notice}</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <section className="card section-stack">
        <div>
          <h2 className="section-title">1. Unlock with World ID</h2>
          <p className="section-copy">
            Use device proof by default for a lighter check, or switch to Orb
            human proof when the experience needs strong proof-of-personhood.
          </p>
        </div>

        <div className="proof-options">
          <button
            type="button"
            className={`proof-toggle ${
              selectedProof === VerificationLevel.Device ? "active" : ""
            }`}
            onClick={() => setSelectedProof(VerificationLevel.Device)}
          >
            <strong>Device proof</strong>
            <span>Default flow. Best for faster camera access in the mini app.</span>
          </button>

          <button
            type="button"
            className={`proof-toggle ${
              selectedProof === VerificationLevel.Orb ? "active" : ""
            }`}
            onClick={() => setSelectedProof(VerificationLevel.Orb)}
          >
            <strong>Orb human proof</strong>
            <span>
              Higher-assurance proof-of-personhood for anti-bot or anti-Sybil
              flows.
            </span>
          </button>
        </div>

        <div className="status-row">
          <span className="pill">
            Selected mode: <strong>{activeProofConfig.label}</strong>
          </span>
          <span className="code-chip">{activeProofConfig.action}</span>
        </div>

        <p className="helper">
          <strong>Flow note:</strong> World App returns a proof payload, the
          server verifies it, and the verified result becomes the app decision
          to allow camera access.
        </p>

        <div className="button-row">
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
            onClick={handleResetProof}
            disabled={!proofSession}
          >
            Reset local proof
          </button>
        </div>

        {isDevBypassEnabled() ? (
          <p className="helper">
            <strong>Dev bypass:</strong> enabled for browser preview while you
            wait on real credentials. Turn it off before submission.
          </p>
        ) : null}

        {proofSession ? (
          <>
            <div className="status-row">
              <span className="pill pill-success">
                Decision:{" "}
                <strong>
                  {proofSession.decision.allowCamera
                    ? "Allow camera"
                    : "Block camera"}
                </strong>
              </span>
              <span className="pill">
                Source:{" "}
                <strong>
                  {proofSession.source === "world-id"
                    ? "Verified proof"
                    : "Local dev bypass"}
                </strong>
              </span>
            </div>

            <p className="helper">
              <strong>Reason:</strong> {proofSession.decision.reason}
            </p>

            {proofSession.nullifierHash ? (
              <div className="section-stack">
                <span className="code-chip">
                  nullifier_hash: {proofSession.nullifierHash}
                </span>
                <span className="code-chip">
                  merkle_root: {proofSession.merkleRoot}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card section-stack">
        <div>
          <h2 className="section-title">2. Capture a photo</h2>
          <p className="section-copy">
            Once proof is accepted, the app unlocks both a live camera preview
            and a simpler fallback that opens the device camera directly.
          </p>
        </div>

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
                <strong>Camera preview appears here after unlock.</strong>
                <span>
                  If live preview fails inside a browser or simulator, use Quick
                  capture to open the device camera instead.
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
          <strong>Storage:</strong> photos are saved into IndexedDB, so they
          stay inside this mini app on the current device until cleared.
        </p>

        <p className="helper">
          <strong>Optional Filecoin sync:</strong> after a photo is saved
          locally, you can upload it to Filecoin Calibration through Synapse
          SDK and keep the returned storage proof details in the gallery.
        </p>

        {cameraError ? <p className="helper">{cameraError}</p> : null}
      </section>

      <section className="card section-stack">
        <div>
          <h2 className="section-title">3. Local photo library</h2>
          <p className="section-copy">
            This gallery reads directly from the app’s local storage so you can
            prove the end-to-end flow works on mobile.
          </p>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void refreshGallery()}
          >
            Refresh gallery
          </button>

          <button
            type="button"
            className="button button-ghost button-danger"
            onClick={() => void handleClearLibrary()}
            disabled={!photos.length}
          >
            Clear library
          </button>
        </div>

        {isGalleryLoading ? (
          <p className="helper">Loading local photo library...</p>
        ) : photos.length ? (
          <div className="gallery-grid">
            {photos.map((photo) => (
              <article key={photo.id} className="photo-card">
                <Image
                  src={photo.previewUrl}
                  alt={`Captured ${formatDate(photo.createdAt)}`}
                  width={1200}
                  height={1400}
                  sizes="(max-width: 520px) 100vw, 50vw"
                  unoptimized
                />
                <div className="photo-body">
                  <div className="photo-meta">
                    <strong>{formatDate(photo.createdAt)}</strong>
                    <span>{proofLabel(photo.verificationLevel)}</span>
                    <span>{photo.mimeType}</span>
                    {photo.filecoin ? (
                      <>
                        <span>
                          Filecoin PieceCID:{" "}
                          {formatCompactHash(photo.filecoin.pieceCid)}
                        </span>
                        {photo.filecoin.transactionHash ? (
                          <span>
                            Tx:{" "}
                            {formatCompactHash(photo.filecoin.transactionHash)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span>Stored locally only</span>
                    )}
                  </div>
                  <div className="button-row">
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
                        ? "Uploaded to Filecoin"
                        : uploadingPhotoId === photo.id
                          ? "Uploading..."
                          : "Upload to Filecoin"}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="button button-ghost button-danger"
                    onClick={() => void handleDeletePhoto(photo.id)}
                  >
                    Delete photo
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            No photos saved yet. Verify the user, open the camera, and capture a
            photo to populate the gallery.
          </div>
        )}
      </section>
    </div>
  );
}
