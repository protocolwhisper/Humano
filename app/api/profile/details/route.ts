import { NextRequest, NextResponse } from "next/server";

import { updateUserProfileDetails } from "@/lib/server/profile-metadata-store";

export const runtime = "nodejs";

interface ProfileDetailsRequestBody {
  uploaderKey: string;
  displayName: string;
  handle: string;
  bio: string;
}

export async function POST(request: NextRequest) {
  let body: ProfileDetailsRequestBody;

  try {
    body = (await request.json()) as ProfileDetailsRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body.uploaderKey !== "string" ||
    typeof body.displayName !== "string" ||
    typeof body.handle !== "string" ||
    typeof body.bio !== "string"
  ) {
    return NextResponse.json(
      { success: false, error: "Missing profile details." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await updateUserProfileDetails({
      uploaderKey: body.uploaderKey,
      displayName: body.displayName,
      handle: body.handle,
      bio: body.bio,
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
          error instanceof Error ? error.message : "Profile update failed.",
      },
      { status: 500 },
    );
  }
}
