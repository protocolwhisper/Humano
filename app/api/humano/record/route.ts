import { NextRequest, NextResponse } from "next/server";

import { type HumanoProtocolRecord } from "@/lib/humano-protocol";
import { recordHumanoProtocolUpload } from "@/lib/server/humano-protocol-recorder";

export const runtime = "nodejs";

interface RecordRequestBody {
  uploaderKey: string;
  pieceCid: string;
  worldAction: string;
  verificationLevel: string;
  createdAt: string;
  size: number;
  retrievalUrl?: string | null;
}

function readRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function POST(request: NextRequest) {
  let body: RecordRequestBody;

  try {
    body = (await request.json()) as RecordRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body.uploaderKey !== "string" ||
    typeof body.pieceCid !== "string" ||
    typeof body.worldAction !== "string" ||
    typeof body.verificationLevel !== "string" ||
    typeof body.createdAt !== "string" ||
    typeof body.size !== "number"
  ) {
    return NextResponse.json(
      { success: false, error: "Missing onchain tracking metadata." },
      { status: 400 },
    );
  }

  try {
    const privateKey = readRequiredEnv(
      "FILECOIN_WALLET_PRIVATE_KEY",
    ) as `0x${string}`;
    const rpcUrl = process.env.FILECOIN_RPC_URL ?? "https://api.calibration.node.glif.io/rpc/v1";
    const contractAddress = readRequiredEnv(
      "HUMANO_PROTOCOL_CONTRACT_ADDRESS",
    ) as `0x${string}`;

    const humanoProtocol = await recordHumanoProtocolUpload({
      rpcUrl,
      privateKey,
      contractAddress,
      uploaderKey: body.uploaderKey as `0x${string}`,
      pieceCid: body.pieceCid,
      worldAction: body.worldAction,
      verificationLevel: body.verificationLevel,
      createdAt: body.createdAt,
      size: body.size,
      retrievalUrl: body.retrievalUrl ?? null,
    });

    return NextResponse.json({
      success: true,
      humanoProtocol,
    } as {
      success: true;
      humanoProtocol: HumanoProtocolRecord;
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Humano Protocol recording error.",
      },
      { status: 500 },
    );
  }
}
