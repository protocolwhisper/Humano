import type { FilecoinPhotoRecord } from "@/lib/photo-store";
import type { HumanoProtocolRecord } from "@/lib/humano-protocol";

export interface FilecoinUploadSuccessResponse {
  success: true;
  filecoin: FilecoinPhotoRecord;
  humanoProtocol?: HumanoProtocolRecord | null;
  humanoProtocolError?: string | null;
  metadataError?: string | null;
}

export interface FilecoinUploadErrorResponse {
  success: false;
  error: string;
}

export interface HumanoProtocolRecordSuccessResponse {
  success: true;
  humanoProtocol: HumanoProtocolRecord;
  metadataError?: string | null;
}

export interface HumanoProtocolRecordErrorResponse {
  success: false;
  error: string;
}

export type FilecoinUploadResponse =
  | FilecoinUploadSuccessResponse
  | FilecoinUploadErrorResponse;

export type HumanoProtocolRecordResponse =
  | HumanoProtocolRecordSuccessResponse
  | HumanoProtocolRecordErrorResponse;

export function humanizeFilecoinError(error: string) {
  if (error.includes("FILECOIN_WALLET_PRIVATE_KEY")) {
    return "Filecoin upload is not configured yet. Add the Filecoin wallet env vars first.";
  }

  if (error.includes("HUMANO_PROTOCOL_CONTRACT_ADDRESS")) {
    return "Humano Protocol is not configured yet. Deploy the contract and add its address first.";
  }

  if (
    error.includes("insufficient funds") ||
    error.includes("funds") ||
    error.includes("USDFC") ||
    error.includes("allowance") ||
    error.includes("approval") ||
    error.includes("gas")
  ) {
    return "The Filecoin Calibration wallet likely needs testnet funds, gas, or payment approvals before uploads can succeed.";
  }

  if (error.includes("InsufficientLockupFunds")) {
    return "This wallet has Calibration FIL for gas, but the warm-storage provider sees zero lockup funds available for the storage commit. Top up or approve the storage lockup balance for this payer before syncing.";
  }

  return error;
}
