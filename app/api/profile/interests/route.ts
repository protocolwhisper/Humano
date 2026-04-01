import { NextRequest, NextResponse } from "next/server";

import { replaceUserInterests } from "@/lib/server/profile-metadata-store";

export const runtime = "nodejs";

interface InterestsRequestBody {
  uploaderKey: string;
  interests: string[];
}

export async function POST(request: NextRequest) {
  let body: InterestsRequestBody;

  try {
    body = (await request.json()) as InterestsRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body.uploaderKey !== "string" ||
    !Array.isArray(body.interests)
  ) {
    return NextResponse.json(
      { success: false, error: "Missing user interests." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await replaceUserInterests(body.uploaderKey, body.interests);

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
            : "Interest sync failed.",
      },
      { status: 500 },
    );
  }
}
