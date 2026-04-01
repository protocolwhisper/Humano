import { NextRequest, NextResponse } from "next/server";
import { Synapse, calibration } from "@filoz/synapse-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { http } from "viem";

import type { FilecoinUploadSuccessResponse } from "@/lib/filecoin";
import { type HumanoProtocolRecord } from "@/lib/humano-protocol";
import { recordHumanoProtocolUpload } from "@/lib/server/humano-protocol-recorder";
import {
  attachFilecoinMetadata,
  attachHumanoMetadata,
  upsertPhotoMetadata,
} from "@/lib/server/profile-metadata-store";

export const runtime = "nodejs";

function readRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function POST(request: NextRequest) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid multipart form data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const createdAt = formData.get("createdAt");
  const verificationLevel = formData.get("verificationLevel");
  const worldAction = formData.get("worldAction");
  const uploaderKey = formData.get("uploaderKey");
  const photoId = formData.get("photoId");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: "Missing photo file." },
      { status: 400 },
    );
  }

  if (
    typeof createdAt !== "string" ||
    typeof verificationLevel !== "string" ||
    typeof worldAction !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "Missing upload metadata." },
      { status: 400 },
    );
  }

  try {
    const privateKey = readRequiredEnv("FILECOIN_WALLET_PRIVATE_KEY") as `0x${string}`;
    const rpcUrl =
      process.env.FILECOIN_RPC_URL ?? calibration.rpcUrls.default.http[0];
    const account = privateKeyToAccount(privateKey);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    let transactionHash: string | null = null;
    let fundingTransactionHash: string | null = null;
    let humanoProtocol: HumanoProtocolRecord | null = null;
    let humanoProtocolError: string | null = null;
    let metadataError: string | null = null;

    const synapse = Synapse.create({
      account,
      chain: calibration,
      transport: http(rpcUrl),
      source: "proofcam-mini-app",
    });

    const contexts = await synapse.storage.createContexts({
      copies: 1,
      metadata: {
        app: "proofcam-mini-app",
        media: "photo",
      },
    });

    const preparation = await synapse.storage.prepare({
      context: contexts,
      dataSize: BigInt(fileBytes.byteLength),
    });

    if (preparation.transaction) {
      const preparationResult = await preparation.transaction.execute({
        onHash: (hash) => {
          fundingTransactionHash = hash;
        },
      });

      fundingTransactionHash ??= preparationResult.hash;
    }

    const uploadResult = await synapse.storage.upload(fileBytes, {
      contexts,
      pieceMetadata: {
        capturedAt: createdAt,
        mimeType: file.type || "image/jpeg",
        originalName: file.name || "capture.jpg",
        verificationLevel,
        worldAction,
      },
      callbacks: {
        onPiecesAdded: (hash) => {
          transactionHash = hash;
        },
      },
    });

    const primaryCopy = uploadResult.copies[0] ?? null;
    const contractAddress =
      process.env.HUMANO_PROTOCOL_CONTRACT_ADDRESS as `0x${string}` | undefined;

    if (contractAddress && typeof uploaderKey === "string" && uploaderKey) {
      try {
        humanoProtocol = await recordHumanoProtocolUpload({
          rpcUrl,
          privateKey,
          contractAddress,
          uploaderKey: uploaderKey as `0x${string}`,
          pieceCid: uploadResult.pieceCid.toString(),
          worldAction,
          verificationLevel,
          createdAt,
          size: uploadResult.size,
          retrievalUrl: primaryCopy?.retrievalUrl ?? null,
        });
      } catch (error) {
        humanoProtocolError =
          error instanceof Error
            ? error.message
            : "Humano Protocol contract write failed.";
      }
    }

    const responseBody: FilecoinUploadSuccessResponse = {
      success: true,
      filecoin: {
        status: "uploaded",
        uploadedAt: new Date().toISOString(),
        pieceCid: uploadResult.pieceCid.toString(),
        transactionHash,
        retrievalUrl: primaryCopy?.retrievalUrl ?? null,
        providerId: primaryCopy?.providerId.toString() ?? null,
        dataSetId: primaryCopy?.dataSetId.toString() ?? null,
        pieceId: primaryCopy?.pieceId.toString() ?? null,
        copies: uploadResult.copies.length,
        size: uploadResult.size,
        fundingTransactionHash,
      },
      humanoProtocol,
      humanoProtocolError,
      metadataError,
    };

    if (
      typeof photoId === "string" &&
      photoId &&
      typeof uploaderKey === "string" &&
      uploaderKey
    ) {
      try {
        await upsertPhotoMetadata({
          photoId,
          uploaderKey,
          createdAt,
          mimeType: file.type || "image/jpeg",
          verificationLevel,
          worldAction,
        });
        await attachFilecoinMetadata({
          photoId,
          uploaderKey,
          filecoin: responseBody.filecoin,
        });

        if (humanoProtocol) {
          await attachHumanoMetadata({
            photoId,
            uploaderKey,
            humanoProtocol,
          });
        }
      } catch (error) {
        metadataError =
          error instanceof Error
            ? error.message
            : "Postgres metadata sync failed.";
        responseBody.metadataError = metadataError;
      }
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Filecoin upload error.",
      },
      { status: 500 },
    );
  }
}
