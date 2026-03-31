import { NextRequest, NextResponse } from "next/server";
import {
  type ISuccessResult,
  type IVerifyResponse,
  VerificationLevel,
  verifyCloudProof,
} from "@worldcoin/minikit-js";
import { keccak256, stringToBytes } from "viem";

interface VerifyRequestBody {
  payload: ISuccessResult;
  action: string;
  signal?: string;
  commandPayload?: {
    action?: string;
    signal?: string;
    timestamp?: string;
  };
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
  verifyResponse: IVerifyResponse | VerifyV4Response;
}

interface VerifyV4Result {
  identifier: string;
  success: boolean;
  nullifier?: string;
  code?: string;
  detail?: string;
}

interface VerifyV4Response {
  success: boolean;
  results?: VerifyV4Result[];
  action?: string;
  nullifier?: string;
  created_at?: string;
  environment?: "production" | "staging";
  session_id?: string;
  message?: string;
  code?: string;
  detail?: string;
  attribute?: string | null;
}

function formatVerifyFailure(verifyResponse: IVerifyResponse) {
  const parts = [
    "World ID rejected the proof.",
    verifyResponse.code ? `Code: ${verifyResponse.code}.` : null,
    verifyResponse.detail ?? null,
    verifyResponse.attribute
      ? `Attribute: ${verifyResponse.attribute}.`
      : null,
  ].filter(Boolean);

  return parts.join(" ");
}

function formatVerifyFailureV4(verifyResponse: VerifyV4Response) {
  const failedResult = verifyResponse.results?.find((result) => !result.success);

  const parts = [
    "World ID rejected the proof.",
    failedResult?.code ? `Code: ${failedResult.code}.` : null,
    failedResult?.detail ?? verifyResponse.detail ?? verifyResponse.message ?? null,
    failedResult?.identifier ? `Identifier: ${failedResult.identifier}.` : null,
    verifyResponse.attribute ? `Attribute: ${verifyResponse.attribute}.` : null,
  ].filter(Boolean);

  return parts.join(" ");
}

async function verifyProofV4(body: VerifyRequestBody, rpId: string) {
  const signalHash =
    body.commandPayload?.signal ?? hashSignal(body.signal ?? "");
  const nonce =
    body.commandPayload?.timestamp ?? body.signal ?? `proofcam-${Date.now()}`;

  const identifier =
    body.payload.verification_level === VerificationLevel.Device
      ? "device"
      : "orb";

  const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      protocol_version: "3.0",
      nonce,
      action: body.action,
      responses: [
        {
          identifier,
          merkle_root: body.payload.merkle_root,
          nullifier: body.payload.nullifier_hash,
          proof: body.payload.proof,
          signal_hash: signalHash,
          max_age: 304200,
        },
      ],
    }),
  });

  const payload = (await response.json()) as VerifyV4Response;

  return {
    ok: response.ok && payload.success,
    payload,
  };
}

function hashSignal(signal: string) {
  const hash =
    BigInt(keccak256(stringToBytes(signal))) >> BigInt(8);
  return `0x${hash.toString(16).padStart(64, "0")}`;
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
  const rpId = process.env.RP_ID;

  if (!appId && !rpId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing APP_ID or RP_ID. Add your World Developer Portal identifiers before live verification.",
      },
      { status: 503 },
    );
  }

  try {
    if (rpId) {
      const verifyV4Response = await verifyProofV4(body, rpId);

      if (!verifyV4Response.ok) {
        return NextResponse.json(
          {
            success: false,
            error: formatVerifyFailureV4(verifyV4Response.payload),
            errorCode:
              verifyV4Response.payload.results?.find((result) => !result.success)
                ?.code ?? verifyV4Response.payload.code ?? null,
            errorDetail:
              verifyV4Response.payload.results?.find((result) => !result.success)
                ?.detail ?? verifyV4Response.payload.detail ?? null,
            errorAttribute: verifyV4Response.payload.attribute ?? null,
            verifyResponse: verifyV4Response.payload,
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
          nullifierHash:
            verifyV4Response.payload.nullifier ?? body.payload.nullifier_hash,
          merkleRoot: body.payload.merkle_root,
          verificationLevel: body.payload.verification_level,
        },
        verifyResponse: verifyV4Response.payload,
      };

      return NextResponse.json(successResponse);
    }

    const verifyResponse = (await verifyCloudProof(
      body.payload,
      appId as `app_${string}`,
      body.action,
      body.signal,
    )) as IVerifyResponse;

    if (!verifyResponse.success) {
      return NextResponse.json(
        {
          success: false,
          error: formatVerifyFailure(verifyResponse),
          errorCode: verifyResponse.code ?? null,
          errorDetail: verifyResponse.detail ?? null,
          errorAttribute: verifyResponse.attribute ?? null,
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
