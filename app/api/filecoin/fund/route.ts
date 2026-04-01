import { NextRequest, NextResponse } from "next/server";
import { Synapse, calibration } from "@filoz/synapse-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits, http, parseUnits } from "viem";

export const runtime = "nodejs";

function readRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function POST(request: NextRequest) {
  try {
    let amount = "1";

    try {
      const body = (await request.json()) as { amount?: string | number };
      if (body?.amount !== undefined) {
        amount = String(body.amount);
      }
    } catch {
      // Allow empty POST body and fall back to 1 tUSDFC.
    }

    const parsedAmount = parseUnits(amount, 18);

    if (parsedAmount <= BigInt(0)) {
      return NextResponse.json(
        { success: false, error: "Amount must be greater than zero." },
        { status: 400 },
      );
    }

    const privateKey = readRequiredEnv("FILECOIN_WALLET_PRIVATE_KEY") as `0x${string}`;
    const rpcUrl =
      process.env.FILECOIN_RPC_URL ?? calibration.rpcUrls.default.http[0];
    const account = privateKeyToAccount(privateKey);

    const synapse = Synapse.create({
      account,
      chain: calibration,
      transport: http(rpcUrl),
      source: "proofcam-mini-app",
    });

    const beforeWalletUsdfc = await synapse.payments.walletBalance({ token: "USDFC" });

    const result = await synapse.payments.fundSync({
      amount: parsedAmount,
      needsFwssMaxApproval: false,
    });

    const [afterWalletUsdfc, paymentBalance, paymentInfo] = await Promise.all([
      synapse.payments.walletBalance({ token: "USDFC" }),
      synapse.payments.balance(),
      synapse.payments.accountInfo(),
    ]);

    return NextResponse.json({
      success: true,
      wallet: account.address,
      fundedAmount: {
        raw: parsedAmount.toString(),
        formatted: formatUnits(parsedAmount, 18),
      },
      transactionHash: result.hash,
      walletUsdfcBefore: {
        raw: beforeWalletUsdfc.toString(),
        formatted: formatUnits(beforeWalletUsdfc, 18),
      },
      walletUsdfcAfter: {
        raw: afterWalletUsdfc.toString(),
        formatted: formatUnits(afterWalletUsdfc, 18),
      },
      paymentsAvailableFunds: {
        raw: paymentBalance.toString(),
        formatted: formatUnits(paymentBalance, 18),
      },
      paymentsTotalFunds: {
        raw: paymentInfo.funds.toString(),
        formatted: formatUnits(paymentInfo.funds, 18),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Filecoin funding error.",
      },
      { status: 500 },
    );
  }
}
