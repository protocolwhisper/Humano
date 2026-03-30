import type { FilecoinPhotoRecord } from "@/lib/photo-store";

export interface FilecoinUploadSuccessResponse {
  success: true;
  filecoin: FilecoinPhotoRecord;
}

export interface FilecoinUploadErrorResponse {
  success: false;
  error: string;
}

export type FilecoinUploadResponse =
  | FilecoinUploadSuccessResponse
  | FilecoinUploadErrorResponse;

export function humanizeFilecoinError(error: string) {
  if (error.includes("FILECOIN_WALLET_PRIVATE_KEY")) {
    return "Filecoin upload is not configured yet. Add the Filecoin wallet env vars first.";
  }

  if (
    error.includes("insufficient funds") ||
    error.includes("funds") ||
    error.includes("USDFC") ||
    error.includes("allowance") ||
    error.includes("approval")
  ) {
    return "The Filecoin Calibration wallet likely needs testnet funds or payment approvals before uploads can succeed.";
  }

  return error;
}
