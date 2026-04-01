export interface ProfileMetadataStats {
  photoCount: number;
  filecoinCount: number;
  humanoCount: number;
}

export interface ProfileMetadataProfile {
  displayName: string;
  handle: string;
  bio: string;
}

export interface ProfileMetadataSnapshot {
  interests: string[];
  stats: ProfileMetadataStats;
  profile: ProfileMetadataProfile;
}

export interface ProfileMetadataSuccessResponse {
  success: true;
  snapshot: ProfileMetadataSnapshot;
}

export interface ProfileMetadataErrorResponse {
  success: false;
  error: string;
}

export type ProfileMetadataResponse =
  | ProfileMetadataSuccessResponse
  | ProfileMetadataErrorResponse;
