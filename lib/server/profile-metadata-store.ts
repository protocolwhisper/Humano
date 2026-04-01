import type { PoolClient } from "pg";

import type {
  ProfileMetadataSnapshot,
  ProfileMetadataStats,
} from "@/lib/metadata";
import type { FilecoinPhotoRecord } from "@/lib/photo-store";
import type { HumanoProtocolRecord } from "@/lib/humano-protocol";
import { getPostgresPool } from "@/lib/server/postgres";

interface UserSessionMetadataInput {
  uploaderKey: string;
  verificationLevel: string;
  worldAction: string;
  proofSource: string;
  verifiedAt: string;
  nullifierHash?: string | null;
  merkleRoot?: string | null;
}

interface PhotoMetadataInput {
  photoId: string;
  uploaderKey: string;
  createdAt: string;
  mimeType: string;
  verificationLevel: string;
  worldAction: string;
}

interface FilecoinMetadataInput {
  photoId: string;
  uploaderKey: string;
  filecoin: FilecoinPhotoRecord;
}

interface HumanoMetadataInput {
  photoId: string;
  uploaderKey: string;
  humanoProtocol: HumanoProtocolRecord;
}

let schemaReadyPromise: Promise<void> | null = null;

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureMetadataSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const pool = getPostgresPool();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_users (
          id BIGSERIAL PRIMARY KEY,
          uploader_key TEXT UNIQUE NOT NULL,
          verification_level TEXT NOT NULL,
          world_action TEXT,
          proof_source TEXT NOT NULL,
          nullifier_hash TEXT,
          merkle_root TEXT,
          last_verified_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_interests (
          user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          interest_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, interest_key)
        );

        CREATE TABLE IF NOT EXISTS photo_records (
          id TEXT PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          uploader_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          mime_type TEXT NOT NULL,
          verification_level TEXT NOT NULL,
          world_action TEXT,
          local_status TEXT NOT NULL DEFAULT 'saved',
          deleted_at TIMESTAMPTZ,
          filecoin_status TEXT,
          filecoin_uploaded_at TIMESTAMPTZ,
          piece_cid TEXT,
          filecoin_transaction_hash TEXT,
          retrieval_url TEXT,
          provider_id TEXT,
          data_set_id TEXT,
          piece_id TEXT,
          copies INTEGER,
          size BIGINT,
          humano_contract_address TEXT,
          humano_upload_id TEXT,
          humano_transaction_hash TEXT,
          humano_recorded_at TIMESTAMPTZ,
          recorder_address TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS photo_records_uploader_created_idx
          ON photo_records (uploader_key, created_at DESC);
      `);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}

async function ensureUserRecord(
  client: PoolClient,
  input: UserSessionMetadataInput,
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO app_users (
        uploader_key,
        verification_level,
        world_action,
        proof_source,
        nullifier_hash,
        merkle_root,
        last_verified_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())
      ON CONFLICT (uploader_key)
      DO UPDATE SET
        verification_level = EXCLUDED.verification_level,
        world_action = EXCLUDED.world_action,
        proof_source = EXCLUDED.proof_source,
        nullifier_hash = COALESCE(EXCLUDED.nullifier_hash, app_users.nullifier_hash),
        merkle_root = COALESCE(EXCLUDED.merkle_root, app_users.merkle_root),
        last_verified_at = GREATEST(app_users.last_verified_at, EXCLUDED.last_verified_at),
        updated_at = NOW()
      RETURNING id
    `,
    [
      input.uploaderKey,
      input.verificationLevel,
      input.worldAction,
      input.proofSource,
      input.nullifierHash ?? null,
      input.merkleRoot ?? null,
      input.verifiedAt,
    ],
  );

  return Number(result.rows[0]?.id ?? 0);
}

async function getUserId(client: PoolClient, uploaderKey: string) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM app_users WHERE uploader_key = $1`,
    [uploaderKey],
  );

  const userId = result.rows[0]?.id;
  return userId ? Number(userId) : null;
}

async function readSnapshotForUser(
  client: PoolClient,
  userId: number,
): Promise<ProfileMetadataSnapshot> {
  const interestsResult = await client.query<{ interest_key: string }>(
    `
      SELECT interest_key
      FROM user_interests
      WHERE user_id = $1
      ORDER BY created_at ASC, interest_key ASC
    `,
    [userId],
  );

  const statsResult = await client.query<{
    photo_count: string;
    filecoin_count: string;
    humano_count: string;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS photo_count,
        COUNT(*) FILTER (
          WHERE deleted_at IS NULL
            AND piece_cid IS NOT NULL
        ) AS filecoin_count,
        COUNT(*) FILTER (
          WHERE deleted_at IS NULL
            AND humano_upload_id IS NOT NULL
        ) AS humano_count
      FROM photo_records
      WHERE user_id = $1
    `,
    [userId],
  );

  const statsRow = statsResult.rows[0];
  const stats: ProfileMetadataStats = {
    photoCount: Number(statsRow?.photo_count ?? 0),
    filecoinCount: Number(statsRow?.filecoin_count ?? 0),
    humanoCount: Number(statsRow?.humano_count ?? 0),
  };

  return {
    interests: interestsResult.rows.map((row) => row.interest_key),
    stats,
  };
}

export async function getProfileSnapshot(
  uploaderKey: string,
): Promise<ProfileMetadataSnapshot> {
  await ensureMetadataSchema();

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const userId = await getUserId(client, uploaderKey);

    if (!userId) {
      return {
        interests: [],
        stats: {
          photoCount: 0,
          filecoinCount: 0,
          humanoCount: 0,
        },
      };
    }

    return await readSnapshotForUser(client, userId);
  } finally {
    client.release();
  }
}

export async function upsertUserSession(input: UserSessionMetadataInput) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    await ensureUserRecord(client, input);
  });
}

export async function replaceUserInterests(
  uploaderKey: string,
  interests: string[],
) {
  await ensureMetadataSchema();

  const normalizedInterests = Array.from(
    new Set(
      interests
        .map((interest) => interest.trim())
        .filter(Boolean),
    ),
  );

  return withTransaction(async (client) => {
    const userId = await getUserId(client, uploaderKey);

    if (!userId) {
      throw new Error("User session metadata was not found for this uploader.");
    }

    await client.query(`DELETE FROM user_interests WHERE user_id = $1`, [userId]);

    for (const interest of normalizedInterests) {
      await client.query(
        `
          INSERT INTO user_interests (user_id, interest_key)
          VALUES ($1, $2)
          ON CONFLICT (user_id, interest_key) DO NOTHING
        `,
        [userId, interest],
      );
    }

    return readSnapshotForUser(client, userId);
  });
}

export async function upsertPhotoMetadata(input: PhotoMetadataInput) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    const userId = await ensureUserRecord(client, {
      uploaderKey: input.uploaderKey,
      verificationLevel: input.verificationLevel,
      worldAction: input.worldAction,
      proofSource: "metadata-sync",
      verifiedAt: input.createdAt,
    });

    await client.query(
      `
        INSERT INTO photo_records (
          id,
          user_id,
          uploader_key,
          created_at,
          mime_type,
          verification_level,
          world_action,
          local_status,
          updated_at
        )
        VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, 'saved', NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          uploader_key = EXCLUDED.uploader_key,
          created_at = EXCLUDED.created_at,
          mime_type = EXCLUDED.mime_type,
          verification_level = EXCLUDED.verification_level,
          world_action = EXCLUDED.world_action,
          local_status = 'saved',
          deleted_at = NULL,
          updated_at = NOW()
      `,
      [
        input.photoId,
        userId,
        input.uploaderKey,
        input.createdAt,
        input.mimeType,
        input.verificationLevel,
        input.worldAction,
      ],
    );

    return readSnapshotForUser(client, userId);
  });
}

export async function markPhotoDeleted(photoId: string, uploaderKey: string) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    await client.query(
      `
        UPDATE photo_records
        SET
          local_status = 'deleted',
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND uploader_key = $2
      `,
      [photoId, uploaderKey],
    );

    const userId = await getUserId(client, uploaderKey);

    if (!userId) {
      return {
        interests: [],
        stats: {
          photoCount: 0,
          filecoinCount: 0,
          humanoCount: 0,
        },
      };
    }

    return readSnapshotForUser(client, userId);
  });
}

export async function clearUserPhotos(uploaderKey: string) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    await client.query(
      `
        UPDATE photo_records
        SET
          local_status = 'deleted',
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE uploader_key = $1 AND deleted_at IS NULL
      `,
      [uploaderKey],
    );

    const userId = await getUserId(client, uploaderKey);

    if (!userId) {
      return {
        interests: [],
        stats: {
          photoCount: 0,
          filecoinCount: 0,
          humanoCount: 0,
        },
      };
    }

    return readSnapshotForUser(client, userId);
  });
}

export async function attachFilecoinMetadata(input: FilecoinMetadataInput) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    await client.query(
      `
        UPDATE photo_records
        SET
          filecoin_status = $3,
          filecoin_uploaded_at = $4::timestamptz,
          piece_cid = $5,
          filecoin_transaction_hash = $6,
          retrieval_url = $7,
          provider_id = $8,
          data_set_id = $9,
          piece_id = $10,
          copies = $11,
          size = $12,
          updated_at = NOW()
        WHERE id = $1 AND uploader_key = $2
      `,
      [
        input.photoId,
        input.uploaderKey,
        input.filecoin.status,
        input.filecoin.uploadedAt,
        input.filecoin.pieceCid,
        input.filecoin.transactionHash,
        input.filecoin.retrievalUrl,
        input.filecoin.providerId,
        input.filecoin.dataSetId,
        input.filecoin.pieceId,
        input.filecoin.copies,
        input.filecoin.size,
      ],
    );

    const userId = await getUserId(client, input.uploaderKey);

    if (!userId) {
      return {
        interests: [],
        stats: {
          photoCount: 0,
          filecoinCount: 0,
          humanoCount: 0,
        },
      };
    }

    return readSnapshotForUser(client, userId);
  });
}

export async function attachHumanoMetadata(input: HumanoMetadataInput) {
  await ensureMetadataSchema();

  return withTransaction(async (client) => {
    await client.query(
      `
        UPDATE photo_records
        SET
          humano_contract_address = $3,
          humano_upload_id = $4,
          humano_transaction_hash = $5,
          humano_recorded_at = $6::timestamptz,
          recorder_address = $7,
          updated_at = NOW()
        WHERE id = $1 AND uploader_key = $2
      `,
      [
        input.photoId,
        input.uploaderKey,
        input.humanoProtocol.contractAddress,
        input.humanoProtocol.uploadId,
        input.humanoProtocol.transactionHash,
        input.humanoProtocol.recordedAt,
        input.humanoProtocol.recorder,
      ],
    );

    const userId = await getUserId(client, input.uploaderKey);

    if (!userId) {
      return {
        interests: [],
        stats: {
          photoCount: 0,
          filecoinCount: 0,
          humanoCount: 0,
        },
      };
    }

    return readSnapshotForUser(client, userId);
  });
}
