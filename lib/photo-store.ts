import { VerificationLevel } from "@worldcoin/minikit-js";

export interface FilecoinPhotoRecord {
  status: "uploaded";
  uploadedAt: string;
  pieceCid: string;
  transactionHash: string | null;
  retrievalUrl: string | null;
  providerId: string | null;
  dataSetId: string | null;
  pieceId: string | null;
  copies: number;
  size: number;
}

export interface StoredPhoto {
  id: string;
  createdAt: string;
  mimeType: string;
  verificationLevel: VerificationLevel;
  worldAction?: string;
  blob: Blob;
  filecoin?: FilecoinPhotoRecord;
}

const DATABASE_NAME = "proofcam-mini-app";
const DATABASE_VERSION = 1;
const STORE_NAME = "photos";

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function openDatabase() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("IndexedDB is not available in this browser.");
  }

  const openRequest = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  openRequest.onupgradeneeded = () => {
    const database = openRequest.result;

    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt", { unique: false });
    }
  };

  return requestToPromise(openRequest);
}

export async function listPhotos() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const photos = await requestToPromise(store.getAll());

  database.close();

  return (photos as StoredPhoto[]).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export async function savePhoto(photo: StoredPhoto) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(photo);
  await transactionDone(transaction);
  database.close();
}

export async function deletePhoto(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
  database.close();
}

export async function clearPhotos() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await transactionDone(transaction);
  database.close();
}
