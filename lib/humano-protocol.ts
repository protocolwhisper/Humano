import { decodeEventLog, parseAbi } from "viem";

export const humanoProtocolAbi = parseAbi([
  "function recordPhotoUpload(bytes32 uploaderKey,string pieceCid,string worldAction,string verificationLevel,uint256 capturedAt,uint256 size,string retrievalUrl) returns (uint256 uploadId)",
  "function getPhotoUpload(uint256 uploadId) view returns ((uint256 id, bytes32 uploaderKey, string pieceCid, string worldAction, string verificationLevel, uint256 capturedAt, uint256 recordedAt, uint256 size, string retrievalUrl, address recorder))",
  "function getUploaderUploadIds(bytes32 uploaderKey) view returns (uint256[])",
  "function totalUploads() view returns (uint256)",
  "event PhotoUploadRecorded(uint256 indexed uploadId, bytes32 indexed uploaderKey, string pieceCid, string verificationLevel, string worldAction, address indexed recorder)",
]);

export interface HumanoProtocolRecord {
  contractAddress: string;
  uploadId: string;
  uploaderKey: string;
  pieceCid: string;
  worldAction: string;
  verificationLevel: string;
  capturedAt: string;
  recordedAt: string;
  size: number;
  retrievalUrl: string | null;
  transactionHash: string;
  recorder: string;
}

export function decodeHumanoProtocolLog(log: {
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
}) {
  const decoded = decodeEventLog({
    abi: humanoProtocolAbi,
    data: log.data,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });

  if (decoded.eventName !== "PhotoUploadRecorded") {
    return null;
  }

  return decoded;
}
