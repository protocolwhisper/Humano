import { NextRequest, NextResponse } from "next/server";
import {
  type ISuccessResult,
  type IVerifyResponse,
  verifyCloudProof,
} from "@worldcoin/minikit-js";

interface VerifyRequestBody {
  payload: ISuccessResult;
  action: string;
  signal?: string;
}

interface VerifySuccessResponse {
  success: true;
  verifiedAt: string;
  decision: {
    isVerified: true;
    allowCamera: true;
    reason: string;
  };
  proof: {
    action: string;
    signal?: string;
    nullifierHash: string;
    merkleRoot: string;
    verificationLevel: ISuccessResult["verification_level"];
  };
  verifyResponse: IVerifyResponse;
}

export async function POST(request: NextRequest) {
  let body: VerifyRequestBody;

  try {
    body = (await request.json()) as VerifyRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!body?.payload || !body.action) {
    return NextResponse.json(
      { success: false, error: "Missing payload or action." },
      { status: 400 },
    );
  }

  const appId = process.env.APP_ID as `app_${string}` | undefined;

  if (!appId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing APP_ID. Add your World Developer Portal app id to .env.local before live verification.",
      },
      { status: 503 },
    );
  }

  try {
    const verifyResponse = (await verifyCloudProof(
      body.payload,
      appId,
      body.action,
      body.signal,
    )) as IVerifyResponse;

    if (!verifyResponse.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            "World ID rejected the proof. This usually means the action is already consumed or the action id does not match.",
          verifyResponse,
        },
        { status: 400 },
      );
    }

    const successResponse: VerifySuccessResponse = {
      success: true,
      verifiedAt: new Date().toISOString(),
      decision: {
        isVerified: true,
        allowCamera: true,
        reason:
          "World proof verified. A camera session is now unlocked for this user on this device.",
      },
      proof: {
        action: body.action,
        signal: body.signal,
        nullifierHash: body.payload.nullifier_hash,
        merkleRoot: body.payload.merkle_root,
        verificationLevel: body.payload.verification_level,
      },
      verifyResponse,
    };

    return NextResponse.json(successResponse);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected World ID verification error.",
      },
      { status: 500 },
    );
  }
}
