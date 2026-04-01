import { NextRequest, NextResponse } from "next/server";

import {
  getProfileSnapshot,
  replaceUserInterests,
  upsertUserSession,
} from "@/lib/server/profile-metadata-store";

export const runtime = "nodejs";

interface BootstrapRequestBody {
  uploaderKey: string;
  verificationLevel: string;
  action: string;
  source: string;
  verifiedAt: string;
  nullifierHash?: string | null;
  merkleRoot?: string | null;
  interests?: string[];
}

export async function POST(request: NextRequest) {
  let body: BootstrapRequestBody;

  try {
    body = (await request.json()) as BootstrapRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body.uploaderKey !== "string" ||
    typeof body.verificationLevel !== "string" ||
    typeof body.action !== "string" ||
    typeof body.source !== "string" ||
    typeof body.verifiedAt !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "Missing session metadata." },
      { status: 400 },
    );
  }

  try {
    await upsertUserSession({
      uploaderKey: body.uploaderKey,
      verificationLevel: body.verificationLevel,
      worldAction: body.action,
      proofSource: body.source,
      verifiedAt: body.verifiedAt,
      nullifierHash: body.nullifierHash ?? null,
      merkleRoot: body.merkleRoot ?? null,
    });

    let snapshot = await getProfileSnapshot(body.uploaderKey);

    if (!snapshot.interests.length && Array.isArray(body.interests) && body.interests.length) {
      snapshot = await replaceUserInterests(body.uploaderKey, body.interests);
    }

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
            : "Profile bootstrap failed.",
      },
      { status: 500 },
    );
  }
}
