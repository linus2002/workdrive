/**
 * Data access layer — every read and write of saved data goes through here.
 *
 * Today the app has no backend: state is one JSON document in localStorage and file bytes are Blobs in
 * IndexedDB. Screens and the store (src/store/DriveStore.jsx) only talk to the two modules below, so a
 * server-backed implementation can later replace stateStore.js and fileStore.js (same method names and
 * return shapes, e.g. calling a REST API) without touching any screen.
 *
 * stateStore — the workspace state
 *   load()                     → saved state object | null            (sync; migrations are the caller's job)
 *   save(state)                → { ok, slim?, error? }                (sync; slim = saved without embedded file data)
 *   subscribe(onExternalChange)→ unsubscribe                          (another tab / client saved new state)
 *   clear()                                                           (forget the saved state)
 *
 * fileStore — file bytes keyed by blob key (item id, or `<id>@v<no>` for an older version); all async
 *   put(id, blob)  get(id) → Blob|undefined  delete(id)  list() → keys  loadAll() → [[id, Blob]]
 *   clear()  replaceAll([[id, Blob]])  usage() → { count, bytes }
 *
 * storageInfo()        → { supported, usage, quota, persisted }      (browser quota; async)
 * requestPersistence() → { supported, granted }                     (ask the browser not to evict our data)
 *
 * secrets              hashSecret(plain) / verifySecret(plain, stored) for link and file-request passwords.
 *
 * Session-only flags (sign-in session id, "this tab is signed in") stay in sessionStorage in DriveStore:
 * they describe this browser tab, not the workspace.
 */
export { stateStore } from './stateStore';
export { fileStore } from './fileStore';
export { storageInfo, requestPersistence } from './quota';
export { hashSecret, verifySecret, hasSecret, storedSecret } from './secrets';
