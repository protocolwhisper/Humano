import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { filecoinCalibration } from "viem/chains";

import {
  decodeHumanoProtocolLog,
  humanoProtocolAbi,
  type HumanoProtocolRecord,
} from "@/lib/humano-protocol";

interface RecordHumanoProtocolInput {
  rpcUrl: string;
  privateKey: `0x${string}`;
  contractAddress: `0x${string}`;
  uploaderKey: `0x${string}`;
  pieceCid: string;
  worldAction: string;
  verificationLevel: string;
  createdAt: string;
  size: number;
  retrievalUrl: string | null;
}

export async function recordHumanoProtocolUpload(
  input: RecordHumanoProtocolInput,
) {
  const account = privateKeyToAccount(input.privateKey);
  const transport = http(input.rpcUrl);
  const publicClient = createPublicClient({
    chain: filecoinCalibration,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: filecoinCalibration,
    transport,
  });

  const capturedAtUnix = Math.floor(new Date(input.createdAt).getTime() / 1000);

  const humanoTxHash = await walletClient.writeContract({
    address: input.contractAddress,
    abi: humanoProtocolAbi,
    functionName: "recordPhotoUpload",
    args: [
      input.uploaderKey,
      input.pieceCid,
      input.worldAction,
      input.verificationLevel,
      BigInt(
        Number.isFinite(capturedAtUnix)
          ? capturedAtUnix
          : Math.floor(Date.now() / 1000),
      ),
      BigInt(input.size),
      input.retrievalUrl ?? "",
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: humanoTxHash,
  });

  const humanoLog = receipt.logs
    .map((log) => {
      try {
        return decodeHumanoProtocolLog({
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })
    .find((decodedLog) => decodedLog !== null);

  const record: HumanoProtocolRecord = {
    contractAddress: input.contractAddress,
    uploadId:
      humanoLog?.args.uploadId?.toString() ?? receipt.blockNumber.toString(),
    uploaderKey: input.uploaderKey,
    pieceCid: input.pieceCid,
    worldAction: input.worldAction,
    verificationLevel: input.verificationLevel,
    capturedAt: input.createdAt,
    recordedAt: new Date().toISOString(),
    size: input.size,
    retrievalUrl: input.retrievalUrl,
    transactionHash: humanoTxHash,
    recorder: account.address,
  };

  return record;
}
