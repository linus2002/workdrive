# Bishnoi One WorkDrive (prototype)

A front-end prototype of an enterprise cloud file manager, modeled on the Zoho WorkDrive experience. Branding, people and data are fictional placeholders.

## Run

```bash
npm install
npm run dev      # http://localhost:5173 (Vite picks the next free port if taken)
npm run build    # production build in dist/
npm run lint     # code checker (catches undefined names and misused React hooks)
npm test         # logic tests (Vitest)
npm run test:e2e # browser tests + accessibility scan; needs `npm run dev` running and Edge or Chrome installed
npm run check    # lint + tests + build
```

No backend is required. All data lives in the browser: app state in `localStorage` (`workvault-drive:v1`) and file
bytes in IndexedDB, both behind the storage layer in `src/data/storage/` (swap those modules for a server-backed
version later without touching screens). Use **Settings → Preferences → Reset demo data** to restore the sample
workspace, and **Settings → Backup & restore** to export the whole workspace (with files) as a .zip or import one.

Also built in without a backend: hashed link/file-request passwords (PBKDF2), crash screens per screen/dialog/preview,
signatures and markup drawn into the original PDF (pdf-lib), smooth scrolling in large folders, find-in-file in previews
(Ctrl/Cmd+F), install-as-app with offline support (production build), and English / Filipino / Spanish for the main
layout, menus, file lists and sign-in (Settings → Language & region).

## Modules

My Folders, Team Folders, My Files, Shared with Me, Shared by Me, Recent Files, Favorites, Trash,
Templates, Search, Settings (profile, preferences, notifications, appearance, language, security, storage)
and Admin Console (users, teams, storage, organization, permission policies, audit logs).

### File collaboration

- **Version history:** every save from the editor and every "Upload new version" keeps the previous contents.
  Versions can be downloaded, restored (restoring creates a new version, so nothing is lost) or deleted by a manager.
- **Comments:** threaded comments with replies, resolve/reopen, edit/delete and `@mentions` with autocomplete.
  Mentioning someone without access offers to share the file with them.
- **Lock (check-out):** a locked file can be viewed but not edited, renamed, moved or deleted by anyone else.
  The holder, a folder manager or an org admin can unlock it.
- **Presence:** avatars show who else is viewing or editing a file (simulated, since there is no backend).

### Viewing & editing

- **Compare versions:** Version history → "Compare versions" (or "Compare with current" on any version, or right-click →
  Compare versions). Text, documents, PDFs (text layer), slides and uploaded Word/Excel/PowerPoint files are shown side by
  side or inline with added, removed and changed lines and word-level highlights. "Only changes" folds unchanged lines.
  Spreadsheets are compared cell by cell. Images can be compared side by side, with a swipe slider, or as a pixel
  difference.
- **PDF & image markup:** "Markup" in the preview bar. Tools: select/move, pen, highlighter, box, text, sticky notes and
  stamps (Approved, Reviewed, Draft, Confidential, Rejected, Paid), plus an eraser, colours and undo/redo (keyboard
  shortcuts shown on hover). Markup is saved as a separate layer, so the file itself isn't changed. Anyone with
  commenter access can mark up. Saved markup can be shown or hidden, and "Download with markup" exports a flattened PNG
  or PDF (notes are numbered and listed).
- **More previews:** Markdown is rendered (headings, lists, task lists, tables, code blocks, links), with a Source view
  and a live preview while editing. Code files (JS/TS, Python, Java, C/C++/C#, Go, Rust, PHP, Ruby, shell, SQL, CSS,
  HTML/XML, YAML, JSON and more) get syntax highlighting, line numbers, wrapping and copy. Audio files (MP3, WAV, OGG,
  M4A, AAC, FLAC) play in a player with a waveform, skip, speed and volume. Images show a filmstrip of the folder's other
  images and a full-screen slideshow with autoplay.
- **Request a signature:** right-click a PDF → Request signature. Add signers (from the directory or anyone by email),
  optionally in order, then place Signature, Initials, Date, Name and Text fields on the pages and send. Signers sign by
  typing, drawing or uploading a signature. Drawn strokes are smoothed automatically into clean pen-like lines; uploaded photos or scans (PNG, JPG, WEBP, GIF, BMP, SVG) have the paper background removed and can be recoloured to black or blue ink. Status moves through sent → viewed → signed, or declined (with a reason), and can expire
  or be cancelled. The Signatures page tracks requests waiting for you, sent by you, completed and closed. When everyone
  has signed, a signed copy is saved next to the original, with a certificate of completion as its last page.
  People outside the organization sign through `/sign/<request>/<signer>` links (copy one from the request card to try it).

Prototype limits: e-signatures are simulated and not legally binding (no identity checks, emails or tamper-proof
sealing). Markup and signed copies are flattened to images, so their text isn't selectable.

### Organization

- **Labels:** coloured tags on files and folders (right-click → Labels, works on multi-selections). Admins create,
  rename and delete them in Admin Console → Labels & fields. The sidebar lists every label with a count.
- **Folder colours:** right-click a folder → Folder colour.
- **Custom fields:** admins define data templates (Invoice, Contract, …) with text, number, date and dropdown fields;
  anyone with edit access fills them in on a file. Field values are searchable.
- **Advanced search:** filter by type, owner, modified date, size, label and data template, combined with text search.
  Filters live in the URL, so a filtered search can be bookmarked or shared.
- **Pinned:** pin folders or files to the top of the sidebar (right-click → Pin to sidebar). Pins are per user.

### Sharing & external access

- **Public link page** (`/link/:id`): what a recipient sees, signed in or not. It enforces expiry, sign-in for
  organization-only links, permission for restricted links, and the link password. Use "Preview as an outside visitor"
  in the share dialog (or add `?as=guest`) to see it as an anonymous outsider.
- **View-only & download limits:** turn off "Allow download" (also blocks copy and right-click) or cap the number of
  downloads; the owner can reset the count.
- **Watermarks:** a tiled overlay with the viewer's email (or connection details for anonymous visitors). Admins can
  force it on every public link (Admin Console → Permission policies).
- **Link activity:** views, downloads, wrong passwords and blocked attempts, with device and IP, in the share dialog.
- **File requests** (`/request/:id`): upload-only links into a folder, with optional password, closing date and
  name/email capture. Uploaders never see the folder. Manage them on the File Requests page or right-click a folder →
  Request files.
- **QR codes:** Share dialog → QR code (or the QR button on a file request). Download as PNG or SVG, copy, or print;
  optional brand colour, rounded dots and the organization logo in the middle (uses high error correction so it
  still scans). Scans are tagged "via QR code" in link activity.
- **Embed codes:** Share dialog → Embed, for images, PDFs, documents, sheets, slides, video, audio and text. Gives an
  `<iframe>` snippet (responsive or fixed size, light/dark, title bar and download button on or off) or a link
  button, with a live preview. The embed page (`/embed/:id`) needs an "Anyone with the link" link and still enforces
  expiry, password, download rules, watermark and data protection. Visits show as "via embed".
- **Public page branding** (Admin Console → Public page branding): logo, display name, accent and header colours
  (header text picks black or white automatically; low-contrast accents are flagged), tinted background, welcome
  messages for shared links and file requests (`{sender}`, `{org}`, `{file}` placeholders), footer text, support email
  and "Powered by WorkDrive". Live preview before saving. Applies to link, file-request and embed pages.
- **External collaborators** (Admin Console → External collaborators): every guest (anyone outside the domain or with
  the Guest role) with the files, folders and team folders they can access, their role, who shared it, and when each
  grant expires. Change roles and dates, extend or expire everything at once, remove access, block sign-in, clean up
  expired grants, and export a CSV. New guest access expires after the default set there (30 days); owners can
  change it per person in the Share dialog. Expired access stops working immediately.

Prototype limits: there is no server, so link passwords are stored in plain text in localStorage and visitor IPs
are placeholders from a documentation range. Embeds only render in a browser that has this workspace's data, because
everything lives in that browser's storage.

### File operations

- **Extract ZIP:** right-click a .zip → Extract here (or the button in its preview). Unpacks into a new folder with the
  archive's structure; supports stored and deflate entries and UTF-8 names, and skips unsafe paths (`..`) and
  `__MACOSX` junk. ZIP64 and password-protected archives are reported as unsupported.
- **Folder upload:** "Upload Folder", or drag folders from your computer anywhere onto the app; sub-folders (including
  empty ones) are recreated.
- **Duplicate names on upload:** choose per file (or for all) to **Replace** (saved as a new version of the existing
  file, keeping its comments, sharing and labels), **Keep both** (numbered copy) or **Skip**.
- **Bulk rename:** select several items → F2 (or right-click → Rename N items): find & replace, add text, sequential
  numbering or change case, with a live preview and name-clash warnings.
- **Shortcuts:** right-click → Add shortcut to… places a pointer to a file or folder elsewhere without copying it.
  Opening, downloading and sharing act on the original; broken shortcuts are flagged.

### Productivity

- **Tasks:** right-click a file or folder → Add task (assignee, due date, priority, notes). The Tasks page groups your
  open tasks into Overdue / Due today / Upcoming / No due date, with "Assigned by me" and "Completed" tabs; open
  tasks also show in the item's details panel.
- **Approvals:** right-click a file → Request approval from one or more people ("everyone must approve" or "any one
  approver"), with a respond-by date. Approvers approve or request changes (a comment is required to reject). Final
  approval can add the "Approved" label; a file edited after the request is flagged. See the Approvals page for what's
  waiting for you, what you requested, and history.
- **Activity:** a feed of what happened across your files and teams, grouped by day, filterable by team, person and
  kind of activity, with "new since your last visit" highlighting.
- **Keyboard shortcuts:** press `?` for the full sheet. `G` then `M/T/S/R/F/A/K/P/X` jumps to My Folders, Team
  Folders, Shared with Me, Recent, Favorites, Activity, Tasks, Approvals, Trash; `N` new folder; `U` upload.

The app has a single signed-in user, so other people's responses can't happen live. Sample tasks and approvals are
seeded in both directions so each side of the workflow can be tried.

### Admin & security

- **Data retention** (Admin Console → Data retention): Trash is permanently cleared after the chosen period
  (30 days – 1 year, or never). Cleanup runs on start-up and every 30 minutes while the app is open, or on demand, and
  lowering the period previews what will be deleted first. A per-file version limit caps old versions.
- **Legal holds:** preserve folders, files or whole team folders for a matter. Held items can be moved to Trash, but
  nothing (Delete forever, Empty Trash, retention, version limits) can permanently delete them until the hold is
  released. Held items show a banner in their details and "Legal hold" in Trash.
- **Sessions & devices:** signing in creates a session for this browser. Settings → Security lists your devices
  (sign out one or all others) and recent sign-ins; Admin Console → Sessions & devices lists everyone's sessions and
  can sign a person out everywhere. A session ended elsewhere signs that browser out with an explanation, and the
  session timeout policy signs you out after that much inactivity.
- **Storage analytics** (Admin Console → Storage): totals, usage over time (with a table view), team folders against
  their quotas, usage by file type, the largest files, stale files (30 days – 1 year) and possible duplicates.

Prototype limits: sessions for other people and devices are sample data, and the idle timeout only applies while the
app is open (it does not sign you out after a reload).

### Smart search (search inside files, OCR, suggestions)

- **Search inside files:** a background indexer reads the text in text files, PDFs, Word/Excel/PowerPoint files and
  ZIP listings, so search matches words *inside* files. Results show a highlighted excerpt of the match. On the search
  page, "Match in" narrows to name & details, inside files, or text in images & scans.
- **OCR:** text in images and scanned PDFs (pages with no text layer) is recognised with
  [Tesseract.js](https://github.com/naptha/tesseract.js) in the browser; files are never uploaded anywhere. The first
  run downloads the recognition engine and English language data (~10 MB) from a public CDN, so OCR needs an internet
  connection once. Admins can turn OCR off (Admin Console → Search & OCR).
- **Label & field suggestions:** keyword/pattern rules on the extracted text suggest labels (Confidential, Draft,
  Urgent, Needs review, Approved) and pre-fill Invoice or Contract fields. This is **rule-based, not AI**. Suggestions
  appear in a file's details (apply, review or dismiss); admins can switch to applying them automatically to new
  uploads, which is recorded in the audit log.
- The index lives in the browser's IndexedDB; "Rebuild" in Admin Console → Search & OCR re-reads every file.

### Data loss prevention

- Every file's indexed text (including OCR'd images and scans) is scanned for sensitive data: payment card numbers
  (Luhn + card-network prefix, and not part of a row of figures), IBANs (checksum), bank account numbers, Philippine
  TIN and SSS numbers, US SSNs, passwords & API keys, and lists of 5+ email addresses or phone numbers. Samples are
  always masked.
- Admin Console → **Data protection**: Monitor only / Warn / Block, a severity threshold, whether public links and/or
  sharing outside the organization's domain are checked, per-detector switches, and a report of affected files with
  their exposure and one-click fixes.
- **Warn:** the share dialog asks for confirmation (listing the sensitive files, including ones inside a shared
  folder); overrides are audited. **Block:** public links and external sharing are refused, and existing public links
  to sensitive files stop working for outsiders.
- Files show a shield badge; details list the findings with "Not sensitive" for false positives; search has a
  "Sensitive data" filter.
- Prototype limit: checks use the search index built in the browser, so they apply where WorkDrive has been opened
  and indexed (a real deployment would scan on the server).

### Restore a folder to a date

- A **change journal** records the previous name, location, Trash state and version of an item on every change
  (kept for 180 days, up to 5,000 entries), automatically for every action in the app.
- **Restore to a date…** (folder menu, team-folder options, or Admin Console → Data retention → Recovery) rebuilds how
  the folder looked at the chosen time and previews every change: rename back, move back, restore from Trash, revert
  content (from version history), and move files added later to Trash. Nothing is deleted, the newer content stays in
  version history, and a restore can itself be undone by restoring to just before it. Pick a time, or click
  "Before this" on a change in the timeline. Permanently deleted files are listed but can't be brought back, and files
  checked out by someone else are skipped.
- **Recovery drill** (Admin Console → Data retention): simulates a ransomware-style incident on the sample
  Product & Engineering files so the restore can be practised. It only touches those sample files.
- Changes made before the journal existed can't be rewound, except moves to Trash (which are timestamped).

### Offboarding

- Admin Console → Users → row menu → **Offboard / transfer data…** (and **Remove user…**, which opens the same flow with
  "Delete" chosen). It lists everything the person owns or is responsible for, and you pick who takes it over.
- **Files and folders:** ownership moves to the new owner; sharing on them stays as it was. Team-folder files stay where
  they are. If you take them over yourself, items from their own space go into My Folders → "Transferred from <name>".
- **Work in progress:** open tasks are reassigned, the new owner replaces them on pending approvals, approvals they
  requested and their file requests are handed over, and files they had checked out are unlocked.
- **Access:** removed from files shared with them and from team folders. If they were a team folder's only Admin, the
  new owner becomes Admin, so no team folder is left without one. Their sessions are signed out.
- **Account:** Deactivate (default; can be reactivated, their name stays on history), Delete, or Keep active (only hand
  over the work, e.g. for a role change). Deleting is blocked while their files would be left without an owner.
- Each step can be switched off; the result is summarised and recorded in the audit log as "User offboarded".

## Structure

```
src/
  data/mockData.js            sample users, teams, files, notifications, audit log, templates
  store/
    DriveStore.jsx            app state + all operations, persisted to localStorage
    selectors.js              derived data (paths, access levels, usage, pickers)
    UIContext.jsx             toasts, dialogs, preview, context menu, current folder
    UploadContext.jsx         upload queue with simulated progress, cancel and retry
    useItemActions.jsx        open / download / share / trash / restore / menus
  components/
    layout/                   AppLayout, Sidebar, Topbar, SearchBar, PageHeader + Breadcrumbs
    files/                    FileBrowser, FileToolbar, FileList, FileGrid, FileDetailsPanel, dnd
    dialogs/                  create folder/doc, rename, move/copy, share, upload, team, help
    preview/                  FilePreview + viewers (image, PDF, text, doc, sheet, slides, video, zip)
    common/                   Modal, menus, avatars, file icons, toasts, switches, skeletons
  views/                      one component per module
  utils/                      formatting, file types, sample content, file exporters
```

## Prototype notes

- Uploads use the browser's File API. Text, image and PDF files under 400 KB are stored in localStorage;
  larger files stay available until the page is reloaded.
- Downloads of sample files produce real files (PDF, DOCX, XLSX, PNG/JPEG, SVG, ZIP). Folders and
  multi-selections download as a ZIP archive. Formats that can't be generated (PPTX, MP4, legacy DOC/XLS)
  download as a text placeholder.
- Sharing, team membership, notifications and admin policies are simulated locally.
