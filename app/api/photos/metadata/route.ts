import { NextRequest, NextResponse } from "next/server";

import {
  clearUserPhotos,
  markPhotoDeleted,
  upsertPhotoMetadata,
} from "@/lib/server/profile-metadata-store";

export const runtime = "nodejs";

interface PhotoMetadataRequestBody {
  photoId: string;
  uploaderKey: string;
  createdAt: string;
  mimeType: string;
  verificationLevel: string;
  worldAction: string;
}

interface PhotoDeleteRequestBody {
  uploaderKey: string;
  photoId?: string;
}

export async function POST(request: NextRequest) {
  let body: PhotoMetadataRequestBody;

  try {
    body = (await request.json()) as PhotoMetadataRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body.photoId !== "string" ||
    typeof body.uploaderKey !== "string" ||
    typeof body.createdAt !== "string" ||
    typeof body.mimeType !== "string" ||
    typeof body.verificationLevel !== "string" ||
    typeof body.worldAction !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "Missing photo metadata." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await upsertPhotoMetadata({
      photoId: body.photoId,
      uploaderKey: body.uploaderKey,
      createdAt: body.createdAt,
      mimeType: body.mimeType,
      verificationLevel: body.verificationLevel,
      worldAction: body.worldAction,
    });

    return NextResponse.json({
      success: true,
      snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Photo metadata sync failed.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  let body: PhotoDeleteRequestBody;

  try {
    body = (await request.json()) as PhotoDeleteRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (typeof body.uploaderKey !== "string") {
    return NextResponse.json(
      { success: false, error: "Missing uploader key." },
      { status: 400 },
    );
  }

  try {
    const snapshot = body.photoId
      ? await markPhotoDeleted(body.photoId, body.uploaderKey)
      : await clearUserPhotos(body.uploaderKey);

    return NextResponse.json({
      success: true,
      snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Photo deletion sync failed.",
      },
      { status: 500 },
    );
  }
}
