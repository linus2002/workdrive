import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink, Eye, Download, PenLine, FolderInput, Copy, Share2, Link2, Star, StarOff, Info, Trash2,
  FolderPlus, RotateCcw, XCircle, UserMinus, FolderOpen, MessageSquare, History, Lock, Unlock,
  Tag, Palette, ListPlus, Pin, PinOff, Inbox, CornerUpRight, FileArchive, CheckSquare, BadgeCheck, ShieldAlert, GitCompare, PenTool,
} from 'lucide-react';
import { signWaitingForMe } from '../signatures/signing';
import { useDrive, blobRegistry, registerBlob, blobsReady } from './DriveStore';
import { useUI } from './UIContext';
import { accessOf, canEdit, folderRoute, parentRoute, liveDescendantIds, ancestors, isTrashedDeep, lockedByOther, lockedInside, canForceUnlock, openCommentCount, isPinned, shortcutTarget, uniqueName, canCommentAccess, blocksPermanentDelete, canManage, canDownload, quotaError, shareActive } from './selectors';
import { getFileType, MIME, genThumb } from '../utils/fileTypes';
import { makeZip, makePdf, makeDocx, makeXlsx, svgToRaster, svgToRasterNatural, dataUrlToBlob, saveBlob } from '../utils/exporters';
import { sampleSheet, sampleText, sampleSlides, sampleArchive } from '../utils/sampleContent';
import { readZip, safeZipPath, ZipError } from '../utils/zip';
import { readUploadExtras } from './UploadContext';
import { useT } from '../i18n';

/** Produce a Blob for a file item: original bytes when available, otherwise a generated sample. */
export async function fileBlob(item) {
  let reg = blobRegistry.get(item.id);
  if (!reg && !item.dataUrl) {
    // Right after a page load the saved bytes may still be coming out of IndexedDB.
    await Promise.race([blobsReady, new Promise((r) => setTimeout(r, 5000))]);
    reg = blobRegistry.get(item.id);
  }
  if (reg) return reg.blob;
  // A real upload whose bytes are missing must not be replaced by an invented sample (e.g. for signing).
  if (item.mime && !item.dataUrl && !item.content && !item.sheet && !item.slides) {
    throw new Error('The contents of this file aren’t available in this browser.');
  }
  if (item.dataUrl) {
    // Sample "photos" are stored as SVG; hand out a real PNG/JPEG when the file is named that way.
    if (item.dataUrl.startsWith('data:image/svg') && item.ext !== 'svg') return svgToRasterNatural(item.dataUrl, item.ext === 'png' ? 'image/png' : 'image/jpeg');
    return dataUrlToBlob(item.dataUrl);
  }
  const cat = getFileType(item.ext).category;
  const mime = MIME[item.ext] || 'application/octet-stream';
  if (cat === 'text') return new Blob([item.content ?? ''], { type: mime });
  if (cat === 'pdf') return makePdf(item.name.replace(/\.pdf$/i, ''), sampleText(item));
  if (item.ext === 'docx') return makeDocx(sampleText(item));
  if (item.ext === 'xlsx') return makeXlsx(sampleSheet(item));
  if (item.ext === 'csv') return new Blob([sampleSheet(item).map((r) => r.join(',')).join('\n')], { type: mime });
  if (cat === 'image') {
    const svg = genThumb(item.thumb?.replace('gen:', '') || 1);
    if (item.ext === 'svg') return dataUrlToBlob(svg);
    return svgToRaster(svg, item.ext === 'png' ? 'image/png' : 'image/jpeg');
  }
  if (cat === 'archive') {
    // A real ZIP whose contents match the listing the archive viewer shows for sample files.
    const entries = await Promise.all(sampleArchive(item).map(async (e) => ({ path: e.name, data: await sampleEntryData(e.name, item) })));
    return makeZip(entries);
  }
  return null; // no faithful sample possible (legacy office, video, slides)
}

async function sampleEntryData(path, item) {
  const ext = path.split('.').pop().toLowerCase();
  const n = [...path].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 14, 0) + 1;
  if (ext === 'svg') return decodeURIComponent(genThumb(n).split(',')[1]);
  if (ext === 'png') return new Uint8Array(await (await svgToRaster(genThumb(n), 'image/png', 512, 512)).arrayBuffer());
  if (ext === 'pdf') return new Uint8Array(await makePdf(path.split('/').pop().replace(/\.pdf$/i, ''), `Usage guide from ${item.name}.\n\nThis document was packaged in a sample archive.`).arrayBuffer());
  return `${item.name.replace(/\.[^.]+$/, '')}\n\nSample archive contents. Extract the archive to get these files as separate items.\n`;
}

/** Placeholder text for types we cannot synthesize, so download still yields a useful file. */
function placeholderBlob(item) {
  const extra = getFileType(item.ext).category === 'presentation'
    ? '\n\nSlides:\n' + sampleSlides(item).map((s, i) => `${i + 1}. ${s.title} — ${s.body.replace(/\n/g, ' ')}`).join('\n')
    : '';
  return new Blob([`${item.name}\n\nThis is a sample file in the prototype. Upload a real file to download its original contents.${extra}\n`], { type: 'text/plain' });
}

export function useItemActions() {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const { toast, openDialog, openPreview, setDetailsId, requestDetailsTab } = ui;
  const t = useT();
  const lockHolder = (item) => state.users.find((u) => u.id === item.lock?.by)?.name || t('another user');

  const open = useCallback((item, siblings) => {
    if (!item) return;
    if (item.type === 'shortcut') {
      const target = shortcutTarget(state, item);
      if (!target) { toast(t('The original of "{name}" was deleted or you no longer have access', { name: item.name }), { type: 'error' }); return; }
      item = target; // eslint-disable-line no-param-reassign
      siblings = [target]; // eslint-disable-line no-param-reassign
    }
    if (item.type === 'folder') {
      if (isTrashedDeep(state.items, item.id)) {
        toast(t('"{name}" is in Trash. Restore it to open it.', { name: item.name }), {
          type: 'info',
          action: { label: t('Restore'), onClick: () => { api.restoreItems([item.id]); navigate(folderRoute(item)); } },
        });
        return;
      }
      navigate(folderRoute(item));
      return;
    }
    api.markOpened(item.id);
    openPreview(item.id, (siblings || []).filter((s) => s.type === 'file').map((s) => s.id));
  }, [api, navigate, openPreview, state, toast, t]);

  /** Go to the folder containing the item and highlight it there. */
  const showInFolder = useCallback((item) => {
    navigate(`${parentRoute(state, item)}?highlight=${item.id}`);
  }, [navigate, state]);

  const download = useCallback(async (items) => {
    // Shortcuts download what they point to; broken ones are skipped.
    const all = items.filter(Boolean).map((i) => (i.type === 'shortcut' ? shortcutTarget(state, i) : i)).filter(Boolean);
    if (!all.length) { toast(t('Nothing to download: the original item is no longer available'), { type: 'error' }); return; }
    const list = all.filter((i) => canDownload(state, i));
    if (!list.length) { toast(t('Your administrator doesn’t allow viewers to download files'), { type: 'error' }); return; }
    if (list.length < all.length) toast(t('{n, plural, one {# item} other {# items}} skipped: viewers can’t download them', { n: all.length - list.length }), { type: 'warning' });
    try {
      if (list.length === 1 && list[0].type === 'file') {
        const it = list[0];
        const blob = await fileBlob(it);
        api.logEvent('File downloaded', it.name, '', { itemId: it.id });
        if (blob) { saveBlob(blob, it.name); toast(t('Downloading "{name}"', { name: it.name }), { type: 'success' }); }
        else { saveBlob(placeholderBlob(it), `${it.name}.txt`); toast(t('"{name}" is a sample file, so a text placeholder was downloaded', { name: it.name }), { type: 'info' }); }
        return;
      }
      // Folders or multiple items -> ZIP
      toast(t('Preparing ZIP archive…'));
      const s = api.get();
      const entries = [];
      const addFile = async (it, path) => {
        const blob = (await fileBlob(it)) || placeholderBlob(it);
        entries.push({ path, data: new Uint8Array(await blob.arrayBuffer()) });
      };
      for (const it of list) {
        if (it.type === 'file') await addFile(it, it.name);
        else {
          const ids = liveDescendantIds(s.items, it.id); // not trashed subfolders' contents either
          for (const id of ids) {
            const d = s.items[id];
            if (d.type !== 'file') continue;
            const rel = ancestors(s.items, id).slice(ancestors(s.items, it.id).length).map((a) => a.name).join('/');
            await addFile(d, rel);
          }
          if (!ids.length) entries.push({ path: `${it.name}/`, data: new Uint8Array() });
        }
      }
      const name = list.length === 1 ? `${list[0].name}.zip` : `WorkDrive-${list.length}-items.zip`;
      saveBlob(makeZip(entries), name);
      api.logEvent('File downloaded', name, `${entries.length} file(s)`);
      toast(t('Downloaded {name}', { name }), { type: 'success' });
    } catch (e) {
      toast(e?.message?.includes('aren’t available') ? e.message : t('Download failed. Please try again.'), { type: 'error' });
    }
  }, [api, toast, state, t]);

  /** Unpack a .zip next to it, into a new folder named after the archive. */
  const extractZip = useCallback(async (item) => {
    const s0 = api.get();
    if (!canEdit(accessOf(s0, item.parentId ? s0.items[item.parentId] : item))) { toast(t("You can't add files to this folder"), { type: 'error' }); return; }
    const tid = toast(t('Extracting "{name}"…', { name: item.name }), { duration: 20000 });
    try {
      const blob = await fileBlob(item);
      const entries = await readZip(blob);
      const files = entries.filter((e) => !e.dir && safeZipPath(e.path));
      const dirs = entries.filter((e) => e.dir && safeZipPath(e.path));
      if (!files.length && !dirs.length) { ui.dismissToast(tid); toast(t('The archive is empty'), { type: 'info' }); return; }
      const qErr = quotaError(api.get(), item.space, files.reduce((n, e) => n + (e.data?.length || 0), 0));
      if (qErr) { ui.dismissToast(tid); toast(`${qErr}. Free up space and try again.`, { type: 'error' }); return; }
      // The store snapshot only refreshes on render, so work out the folder's final name now.
      const folderName = uniqueName(api.get(), item.name.replace(/\.zip$/i, '') || 'Extracted', item.parentId, item.space);
      const folderId = api.createFolder(folderName, item.parentId, item.space);
      const folder = { id: folderId, space: item.space, name: folderName };
      for (const d of dirs) api.ensureFolderPath(safeZipPath(d.path), folderId, item.space);
      for (const e of files) {
        const parts = safeZipPath(e.path);
        const name = parts.pop();
        const parentId = parts.length ? api.ensureFolderPath(parts, folderId, item.space) : folderId;
        const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
        const file = new File([e.data], name, { type: MIME[ext] || 'application/octet-stream', lastModified: e.date || Date.now() });
        const created = api.createFile({ name, size: file.size, parentId, space: item.space, mime: file.type, silent: true, ...(await readUploadExtras(file)) }); // eslint-disable-line no-await-in-loop
        registerBlob(created.id, file);
      }
      api.logEvent('Archive extracted', item.name, `${files.length} file(s) into "${folder.name}"`, { itemId: item.id });
      ui.dismissToast(tid);
      toast(t('{n, plural, one {Extracted # file into "{name}"} other {Extracted # files into "{name}"}}', { n: files.length, name: folder.name }), { type: 'success', action: { label: t('Open'), onClick: () => navigate(folderRoute(folder)) } });
    } catch (err) {
      ui.dismissToast(tid);
      toast(err instanceof ZipError ? err.message : t('Could not extract this archive'), { type: 'error' });
    }
  }, [api, navigate, toast, ui, t]);

  const copyLink = useCallback(async (item) => {
    const s = api.get();
    const live = item.link?.enabled && !(item.link.expires && item.link.expires < Date.now());
    const manage = canEdit(accessOf(s, item)) || item.ownerId === s.meId;
    let url; let msg; let action = null;
    if (live) {
      url = `${window.location.origin}/link/${item.id}`;
      msg = t('Link copied to clipboard');
    } else if (manage) {
      // Turn on an organization-only link (never public from here), keeping any options set before.
      const prev = item.link;
      api.setLink(item.id, { ...(prev || { role: 'viewer', expires: null, password: false }), enabled: true, access: prev?.access === 'restricted' ? 'restricted' : 'org', expires: prev?.expires && prev.expires < Date.now() ? null : prev?.expires ?? null });
      url = `${window.location.origin}/link/${item.id}`;
      msg = t('Link sharing turned on for people at {org}. Link copied.', { org: s.org.name });
      action = { label: t('Undo'), onClick: () => api.setLink(item.id, prev ? { ...prev } : { enabled: false, access: 'org', role: 'viewer', expires: null, password: false }) };
    } else {
      // No permission to create links: copy the in-app address, which only works for people with access.
      url = item.type === 'folder' ? `${window.location.origin}${folderRoute(item)}` : `${window.location.origin}${parentRoute(s, item)}?preview=${item.id}`;
      msg = t('Copied. Only people who already have access can open it.');
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(msg, { type: 'success', action });
    } catch {
      toast(t('Link: {url}', { url }), { type: 'info', duration: 8000 });
    }
  }, [api, toast, t]);

  const trash = useCallback((all) => {
    // A folder holding a file someone else has checked out can't be deleted either (the file would go with it).
    const locked = all.filter((i) => lockedInside(state, i.id));
    const denied = all.filter((i) => !locked.includes(i) && !canEdit(accessOf(state, i)) && i.ownerId !== state.meId);
    const items = all.filter((i) => !locked.includes(i) && !denied.includes(i));
    if (locked.length) {
      const one = locked[0];
      const file = lockedInside(state, one.id);
      toast(locked.length > 1 ? t('{n} locked items were skipped', { n: locked.length })
        : file.id === one.id ? t('"{name}" is locked by {user} and can\'t be deleted', { name: one.name, user: lockHolder(one) })
          : t('"{name}" contains "{file}", which {user} has checked out, so it can\'t be deleted', { name: one.name, file: file.name, user: lockHolder(file) }), { type: 'error' });
    }
    if (denied.length) toast(denied.length === 1 ? t('You can only view "{name}", so it can\'t be deleted', { name: denied[0].name }) : t('{n} view-only items were skipped', { n: denied.length }), { type: 'warning' });
    if (!items.length) return;
    const ids = items.map((i) => i.id);
    const doIt = () => {
      api.trashItems(ids);
      setDetailsId((d) => (ids.includes(d) ? null : d));
      toast(ids.length === 1 ? t('"{name}" moved to Trash', { name: items[0].name }) : t('{n} items moved to Trash', { n: ids.length }), {
        type: 'success',
        action: { label: t('Undo'), onClick: () => api.restoreItems(ids) },
      });
    };
    if (state.settings.confirmDelete) {
      openDialog('confirm', {
        title: t('Move to Trash?'),
        message: `${ids.length === 1 ? t('"{name}" will be moved to Trash.', { name: items[0].name }) : t('{n} items will be moved to Trash.', { n: ids.length })} ${state.org.policies.trashRetentionDays
          ? t('{n, plural, one {You can restore it within {days} days.} other {You can restore them within {days} days.}}', { n: ids.length, days: state.org.policies.trashRetentionDays })
          : t('{n, plural, one {You can restore it from Trash at any time.} other {You can restore them from Trash at any time.}}', { n: ids.length })}`,
        confirmLabel: t('Move to Trash'), cancelLabel: t('Cancel'), danger: true, onConfirm: doIt,
      });
    } else doIt();
  }, [api, openDialog, setDetailsId, state, toast, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = useCallback((items) => {
    const relocated = api.restoreItems(items.map((i) => i.id));
    toast(items.length === 1 ? t('"{name}" restored', { name: items[0].name }) : t('{n} items restored', { n: items.length }), { type: 'success' });
    if (relocated) toast(t('{n, plural, one {# item went back to the top level because the original folder no longer exists} other {# items went back to the top level because the original folder no longer exists}}', { n: relocated }), { type: 'info' });
  }, [api, toast, t]);

  const deleteForever = useCallback((items) => {
    openDialog('confirm', {
      title: t('Delete permanently?'),
      message: items.length === 1 ? t('"{name}" will be deleted forever. This action cannot be undone.', { name: items[0].name }) : t('{n} items will be deleted forever. This action cannot be undone.', { n: items.length }),
      confirmLabel: t('Delete forever'), cancelLabel: t('Cancel'), danger: true,
      onConfirm: () => {
        const { deleted, held, locked } = api.deleteForever(items.map((i) => i.id));
        if (deleted) toast(deleted === 1 ? t('Permanently deleted') : t('{n} items permanently deleted', { n: deleted }), { type: 'success' });
        if (locked) toast(t('{n, plural, one {# item contains a file someone else has checked out, so it wasn\'t deleted} other {# items contain files someone else has checked out, so they weren\'t deleted}}', { n: locked }), { type: 'warning', duration: 6000 });
        if (held) toast(t('{n, plural, one {# item is on legal hold and can\'t be permanently deleted} other {# items are on legal hold and can\'t be permanently deleted}}', { n: held }), { type: 'warning', duration: 6000 });
      },
    });
  }, [api, openDialog, toast, t]);

  const setFavorite = useCallback((items, value) => {
    api.setFavorite(items.map((i) => i.id), value);
    toast(value ? (items.length === 1 ? t('Added "{name}" to Favorites', { name: items[0].name }) : t('{n} items added to Favorites', { n: items.length })) : t('Removed from Favorites'), { type: 'success' });
  }, [api, toast, t]);

  /** Open the details panel for an item, optionally on a tab ('comments' | 'versions' | 'activity'). */
  const showDetails = useCallback((item, tab) => {
    setDetailsId(item.id);
    api.updateSettings({ showDetailsPanel: true });
    if (tab) requestDetailsTab(tab, item.id);
  }, [api, setDetailsId, requestDetailsTab]);

  const toggleLock = useCallback((item) => {
    if (!item.lock) {
      api.lockItem(item.id);
      toast(t('"{name}" is locked. Others can view it but can\'t make changes.', { name: item.name }), { type: 'success' });
    } else if (item.lock.by === state.meId) {
      api.unlockItem(item.id);
      toast(t('"{name}" unlocked', { name: item.name }), { type: 'success' });
    } else {
      openDialog('confirm', {
        title: t('Force unlock?'), message: t('{user} has this file checked out. Unlocking it may overwrite changes they haven\'t saved yet.', { user: lockHolder(item) }),
        confirmLabel: t('Unlock'), cancelLabel: t('Cancel'), danger: true, onConfirm: () => { api.unlockItem(item.id); toast(t('"{name}" unlocked', { name: item.name }), { type: 'success' }); },
      });
    }
  }, [api, openDialog, state, toast, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePin = useCallback((item) => {
    const on = !isPinned(api.get(), item.id);
    api.setPinned(item.id, on);
    toast(on ? t('Pinned "{name}" to the sidebar', { name: item.name }) : t('Unpinned "{name}"', { name: item.name }), { type: 'success' });
  }, [api, toast, t]);

  /** Build context menu entries for a selection. context: 'browse' | 'trash' | 'shared' */
  const menuFor = useCallback((items, context = 'browse', extra = {}) => {
    if (!items.length) return [];
    const single = items.length === 1 ? items[0] : null;
    if (context === 'trash') {
      return [
        { label: t('Restore'), icon: RotateCcw, onClick: () => restore(items) },
        items.some((i) => blocksPermanentDelete(state, i.id))
          ? { label: items.length === 1 ? t('On legal hold — can’t delete') : t('Some items are on legal hold'), icon: ShieldAlert, disabled: items.every((i) => blocksPermanentDelete(state, i.id)), onClick: () => deleteForever(items) }
          : { label: t('Delete permanently'), icon: XCircle, danger: true, onClick: () => deleteForever(items) },
        single && { divider: true },
        single && { label: t('View details'), icon: Info, onClick: () => showDetails(single) },
      ].filter(Boolean);
    }
    const ids = items.map((i) => i.id);
    if (single?.type === 'shortcut') {
      // A shortcut has its own small menu: act on the original, or manage the shortcut itself.
      const target = shortcutTarget(state, single);
      const own = canEdit(accessOf(state, single));
      const tAccess = target ? accessOf(state, target) : 'none';
      return [
        { label: target?.type === 'folder' ? t('Open folder') : t('Open'), icon: ExternalLink, onClick: () => open(single), disabled: !target, shortcut: 'Enter' },
        target && { label: t('Show original location'), icon: FolderOpen, onClick: () => showInFolder(target) },
        target && { label: t('Share original'), icon: Share2, onClick: () => openDialog('share', { id: target.id }), disabled: !(canEdit(tAccess) || tAccess === 'owner') },
        target?.type === 'file' && { label: t('Download'), icon: Download, onClick: () => download([single]) },
        { divider: true },
        { label: t('Rename shortcut'), icon: PenLine, onClick: () => openDialog('rename', { id: single.id }), disabled: !own, shortcut: 'F2' },
        { label: t('Move shortcut'), icon: FolderInput, onClick: () => openDialog('moveCopy', { ids, mode: 'move' }), disabled: !own },
        isPinned(state, single.id) ? { label: t('Unpin from sidebar'), icon: PinOff, onClick: () => togglePin(single) } : { label: t('Pin to sidebar'), icon: Pin, onClick: () => togglePin(single) },
        { label: t('View details'), icon: Info, onClick: () => showDetails(single), shortcut: 'I' },
        { divider: true },
        { label: t('Remove shortcut'), icon: Trash2, danger: true, onClick: () => trash([single]), disabled: !own, shortcut: 'Del' },
      ].filter(Boolean);
    }
    const accesses = items.map((i) => accessOf(state, i));
    const editable = accesses.every(canEdit);
    const anyLocked = items.some((i) => lockedByOther(state, i));
    const modifiable = editable && !anyLocked;
    const lockedItem = items.find((i) => lockedByOther(state, i));
    const why = !editable ? t('You have view-only access') : lockedItem ? t('Locked by {user}', { user: lockHolder(lockedItem) }) : undefined;
    const allFav = items.every((i) => i.favorite);
    const isFolder = single?.type === 'folder';
    const singleFile = single?.type === 'file' ? single : null;
    const parentEditable = single && canEdit(accessOf(state, single.parentId ? state.items[single.parentId] : single));
    const lockEntry = singleFile && (singleFile.lock
      ? canForceUnlock(state, singleFile) && { label: singleFile.lock.by === state.meId ? t('Unlock file') : t('Force unlock'), icon: Unlock, onClick: () => toggleLock(singleFile) }
      : editable && { label: t('Lock file'), icon: Lock, onClick: () => toggleLock(singleFile) });
    const comments = singleFile ? openCommentCount(singleFile) : 0;
    const pendingApproval = singleFile && (state.approvals || []).some((a) => a.itemId === singleFile.id && a.status === 'pending');
    const directShare = (i) => (i.sharedWith || []).some((x) => x.userId === state.meId && shareActive(x));
    const sharedWithMe = items.every((i) => i.ownerId !== state.meId && i.space === 'user' && directShare(i));
    const isPdf = singleFile?.ext === 'pdf' && !singleFile.trashed;
    const mySign = isPdf ? signWaitingForMe(state).find((r) => r.itemId === singleFile.id) : null;
    return [
      single && { label: isFolder ? t('Open folder') : t('Open'), icon: ExternalLink, onClick: () => open(single, extra.siblings), shortcut: 'Enter' },
      single && !isFolder && { label: t('Preview'), icon: Eye, onClick: () => open(single, extra.siblings), shortcut: 'Space' },
      single && !extra.inFolder && { label: t('Show in folder'), icon: FolderOpen, onClick: () => showInFolder(single) },
      isFolder && editable && { label: t('Create subfolder'), icon: FolderPlus, onClick: () => openDialog('createFolder', { parentId: single.id, space: single.space }) },
      isFolder && editable && state.org.policies.fileRequests && { label: t('Request files'), icon: Inbox, onClick: () => openDialog('fileRequest', { folderId: single.id }) },
      isFolder && (canManage(accesses[0]) || state.users.find((u) => u.id === state.meId)?.role === 'Admin') && { label: t('Restore to a date…'), icon: History, onClick: () => openDialog('restoreFolder', { folderId: single.id }) },
      { divider: true },
      { label: t('Share'), icon: Share2, onClick: () => openDialog('share', { id: items[0].id }), disabled: !single || !(editable || accesses[0] === 'owner'), hint: !single ? t('Select one item to share') : !(editable || accesses[0] === 'owner') ? t('Only owners and editors can share') : undefined },
      { label: t('Copy link'), icon: Link2, onClick: () => copyLink(items[0]), disabled: !single, hint: !single ? t('Select one item') : undefined },
      { label: t('Download'), icon: Download, onClick: () => download(items), disabled: !items.some((i) => canDownload(state, i)) },
      singleFile?.ext === 'zip' && { label: t('Extract here'), icon: FileArchive, onClick: () => extractZip(singleFile), disabled: !parentEditable },
      { divider: true },
      single
        ? { label: t('Rename'), icon: PenLine, onClick: () => openDialog('rename', { id: single.id }), disabled: !modifiable, hint: modifiable ? undefined : why, shortcut: 'F2' }
        : { label: t('Rename {n} items', { n: items.length }), icon: PenLine, onClick: () => openDialog('bulkRename', { ids }), disabled: !modifiable, hint: modifiable ? undefined : why, shortcut: 'F2' },
      { label: t('Move to'), icon: FolderInput, onClick: () => openDialog('moveCopy', { ids, mode: 'move' }), disabled: !modifiable, hint: modifiable ? undefined : why },
      { label: t('Copy to'), icon: Copy, onClick: () => openDialog('moveCopy', { ids, mode: 'copy' }), disabled: !items.some((i) => canDownload(state, i)) },
      { label: t('Add shortcut to…'), icon: CornerUpRight, onClick: () => openDialog('moveCopy', { ids, mode: 'shortcut' }) },
      { label: allFav ? t('Remove from Favorites') : t('Add to Favorites'), icon: allFav ? StarOff : Star, onClick: () => setFavorite(items, !allFav) },
      single && (isPinned(state, single.id)
        ? { label: t('Unpin from sidebar'), icon: PinOff, onClick: () => togglePin(single) }
        : { label: t('Pin to sidebar'), icon: Pin, onClick: () => togglePin(single) }),
      { divider: true },
      { label: t('Labels'), icon: Tag, onClick: () => openDialog('labels', { ids: items.map((i) => i.id) }), disabled: !editable, hint: editable ? undefined : why },
      items.every((i) => i.type === 'folder') && { label: t('Folder colour'), icon: Palette, onClick: () => openDialog('folderColor', { ids: items.map((i) => i.id) }), disabled: !editable },
      singleFile && { label: singleFile.meta ? t('Edit custom fields') : t('Add custom fields'), icon: ListPlus, onClick: () => openDialog('metadata', { id: singleFile.id }), disabled: !modifiable },
      singleFile && { label: comments ? t('Comments ({n})', { n: comments }) : t('Comments'), icon: MessageSquare, onClick: () => showDetails(singleFile, 'comments') },
      singleFile && { label: t('Version history'), icon: History, onClick: () => showDetails(singleFile, 'versions') },
      singleFile?.versions?.length > 0 && { label: t('Compare versions'), icon: GitCompare, onClick: () => openDialog('compareVersions', { itemId: singleFile.id }) },
      mySign && { label: t('Sign document'), icon: PenTool, onClick: () => openDialog('signDocument', { requestId: mySign.id, signerId: mySign.mySigner.id }) },
      isPdf && !mySign && { label: t('Request signature'), icon: PenTool, onClick: () => openDialog('signRequest', { itemId: singleFile.id }), disabled: !editable },
      lockEntry || null,
      single && canCommentAccess(accesses[0]) && { label: t('Add task'), icon: CheckSquare, onClick: () => openDialog('task', { itemId: single.id }) },
      singleFile && editable && (pendingApproval
        ? { label: t('View approval'), icon: BadgeCheck, onClick: () => showDetails(singleFile) }
        : { label: t('Request approval'), icon: BadgeCheck, onClick: () => openDialog('approval', { itemId: singleFile.id }) }),
      single && { label: t('View details'), icon: Info, onClick: () => showDetails(single), shortcut: 'I' },
      { divider: true },
      sharedWithMe
        ? { label: t('Remove from Shared with Me'), icon: UserMinus, danger: true, onClick: () => {
          const before = items.map((i) => ({ id: i.id, shares: i.sharedWith }));
          items.forEach((i) => api.removeMyAccess(i.id));
          toast(items.length === 1 ? t('Removed "{name}" from Shared with Me. You no longer have access.', { name: items[0].name }) : t('Removed {n} items. You no longer have access.', { n: items.length }), {
            type: 'success', duration: 8000, action: { label: t('Undo'), onClick: () => before.forEach((b) => api.setShares(b.id, b.shares)) },
          });
        } }
        : { label: t('Move to Trash'), icon: Trash2, danger: true, onClick: () => trash(items), disabled: !modifiable, hint: modifiable ? undefined : why, shortcut: 'Del' },
    ].filter(Boolean);
  }, [state, api, open, openDialog, copyLink, download, setFavorite, showDetails, showInFolder, trash, restore, deleteForever, toast, toggleLock, togglePin, extractZip, t]);

  return useMemo(() => ({ open, download, copyLink, trash, restore, deleteForever, setFavorite, showDetails, showInFolder, menuFor, toggleLock, togglePin, extractZip }),
    [open, download, copyLink, trash, restore, deleteForever, setFavorite, showDetails, showInFolder, menuFor, toggleLock, togglePin, extractZip]);
}
