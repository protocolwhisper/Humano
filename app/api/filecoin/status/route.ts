import { NextResponse } from "next/server";
import { Synapse, calibration } from "@filoz/synapse-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits, http } from "viem";

export const runtime = "nodejs";

function readRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function GET() {
  try {
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

    const [walletFil, walletUsdfc, paymentInfo, paymentBalance, approval] =
      await Promise.all([
        synapse.payments.walletBalance({ token: "FIL" }),
        synapse.payments.walletBalance({ token: "USDFC" }),
        synapse.payments.accountInfo(),
        synapse.payments.balance(),
        synapse.payments.serviceApproval(),
      ]);

    return NextResponse.json({
      success: true,
      network: {
        name: calibration.name,
        chainId: calibration.id,
        rpcUrl,
      },
      wallet: {
        address: account.address,
        fil: {
          raw: walletFil.toString(),
          formatted: formatUnits(walletFil, 18),
        },
        usdfc: {
          raw: walletUsdfc.toString(),
          formatted: formatUnits(walletUsdfc, 18),
        },
      },
      payments: {
        availableFunds: {
          raw: paymentBalance.toString(),
          formatted: formatUnits(paymentBalance, 18),
        },
        totalFunds: {
          raw: paymentInfo.funds.toString(),
          formatted: formatUnits(paymentInfo.funds, 18),
        },
        lockupCurrent: {
          raw: paymentInfo.lockupCurrent.toString(),
          formatted: formatUnits(paymentInfo.lockupCurrent, 18),
        },
        lockupRate: paymentInfo.lockupRate.toString(),
        lockupLastSettledAt: paymentInfo.lockupLastSettledAt.toString(),
      },
      approval: {
        isApproved: approval.isApproved,
        rateAllowance: approval.rateAllowance.toString(),
        lockupAllowance: approval.lockupAllowance.toString(),
        rateUsage: approval.rateUsage.toString(),
        lockupUsage: approval.lockupUsage.toString(),
        maxLockupPeriod: approval.maxLockupPeriod.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Filecoin status error.",
      },
      { status: 500 },
    );
  }
}
