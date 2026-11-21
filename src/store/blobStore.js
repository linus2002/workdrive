/**
 * Compatibility wrappers for file-byte persistence. The real implementation lives in the data access
 * layer (src/data/storage/fileStore.js); these keep the old fire-and-forget signatures.
 */
import { fileStore } from '../data/storage';

export const putBlob = (id, blob) => fileStore.put(id, blob).catch(() => {});
export const deleteBlob = (id) => fileStore.delete(id).catch(() => {});
export const clearBlobs = () => fileStore.clear().catch(() => {});

/** Returns [[id, Blob], ...] for every stored file. */
export const loadAllBlobs = () => fileStore.loadAll();
