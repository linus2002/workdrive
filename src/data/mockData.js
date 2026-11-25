// Realistic sample data for the prototype. All names/brands are fictional.
const NOW = Date.now();
const H = 3600 * 1000, D = 24 * H;
const ago = (days, hours = 0) => NOW - days * D - hours * H;

export const ME = 'u1';

export const USERS = [
  { id: 'u1', name: 'Naresh Kumar Bishnoi', email: 'naresh@getmeds.ph', role: 'Admin', title: 'Administrator', dept: 'Management', status: 'active', color: '#1686D9', joined: ago(620) },
  { id: 'u2', name: 'Priya Sharma', email: 'priya.sharma@getmeds.ph', role: 'Member', title: 'Marketing Manager', dept: 'Marketing', status: 'active', color: '#D946EF', joined: ago(540) },
  { id: 'u3', name: 'Daniel Kim', email: 'daniel.kim@getmeds.ph', role: 'Admin', title: 'Engineering Manager', dept: 'Engineering', status: 'active', color: '#0EA5A4', joined: ago(500) },
  { id: 'u4', name: 'Sofia Alvarez', email: 'sofia.alvarez@getmeds.ph', role: 'Member', title: 'Product Designer', dept: 'Design', status: 'active', color: '#EA7A1A', joined: ago(410) },
  { id: 'u5', name: 'Marcus Lee', email: 'marcus.lee@getmeds.ph', role: 'Member', title: 'Financial Analyst', dept: 'Finance', status: 'active', color: '#16A34A', joined: ago(380) },
  { id: 'u6', name: 'Hannah Becker', email: 'hannah.becker@getmeds.ph', role: 'Member', title: 'Content Strategist', dept: 'Marketing', status: 'active', color: '#E5484D', joined: ago(300) },
  { id: 'u7', name: 'Omar Haddad', email: 'omar.haddad@getmeds.ph', role: 'Member', title: 'Backend Engineer', dept: 'Engineering', status: 'active', color: '#6366F1', joined: ago(220) },
  { id: 'u8', name: 'Grace Liu', email: 'grace.liu@getmeds.ph', role: 'Member', title: 'HR Partner', dept: 'People', status: 'invited', color: '#A16207', joined: ago(4) },
];

// Priority team folders (listed first). Ids must start with "t" — that prefix marks a team space.
const pt = (id, name, description, color, members) => ({
  id, name, description, color, ownerId: 'u1', createdAt: ago(30), quota: 100 * 1024 ** 3, priority: true,
  members: [{ userId: 'u1', role: 'Admin' }, ...members.map(([userId, role]) => ({ userId, role }))],
});
export const PRIORITY_TEAMS = [
  pt('t-regulatory', 'Regulatory', 'Product registrations, permits, compliance filings and agency correspondence.', '#0E7490', [['u3', 'Editor'], ['u5', 'Viewer']]),
  pt('t-inlicensing', 'Inlicensing', 'Partner evaluations, licensing agreements and due-diligence files.', '#7C3AED', [['u2', 'Editor'], ['u5', 'Viewer']]),
  pt('t-finance', 'Finance', 'Budgets, invoices, payables, receivables and financial reports.', '#16A34A', [['u5', 'Organizer'], ['u3', 'Viewer']]),
  pt('t-hr', 'HR', 'Policies, onboarding, employee records and hiring plans.', '#DB2777', [['u8', 'Editor'], ['u6', 'Viewer']]),
  pt('t-rx', 'RX', 'Prescription products, pharmacy operations and dispensing guidelines.', '#DC2626', [['u4', 'Editor'], ['u7', 'Viewer']]),
  pt('t-hospital', 'HOSPITAL', 'Hospital accounts, tenders, contracts and supply schedules.', '#2563EB', [['u2', 'Editor'], ['u5', 'Viewer']]),
  pt('t-b2b', 'B2B', 'Distributor and corporate client accounts, price lists and orders.', '#EA7A1A', [['u2', 'Organizer'], ['u6', 'Editor']]),
  pt('t-digital-it', 'DIGITAL/IT', 'Systems, infrastructure, digital projects and IT documentation.', '#4F46E5', [['u3', 'Organizer'], ['u7', 'Editor']]),
];

export const TEAMS = [
  ...PRIORITY_TEAMS,
  { id: 't1', name: 'Marketing', description: 'Campaign assets, brand guidelines and launch plans.', ownerId: 'u2', color: '#D946EF', createdAt: ago(400), quota: 50 * 1024 ** 3,
    members: [{ userId: 'u2', role: 'Admin' }, { userId: 'u1', role: 'Organizer' }, { userId: 'u6', role: 'Editor' }, { userId: 'u4', role: 'Viewer' }] },
  { id: 't2', name: 'Product & Engineering', description: 'Specs, roadmaps, release notes and architecture docs.', ownerId: 'u3', color: '#0EA5A4', createdAt: ago(450), quota: 100 * 1024 ** 3,
    members: [{ userId: 'u3', role: 'Admin' }, { userId: 'u7', role: 'Editor' }, { userId: 'u4', role: 'Editor' }, { userId: 'u1', role: 'Editor' }] },
  { id: 't3', name: 'Finance & Operations', description: 'Budgets, invoices, vendor contracts and reports.', ownerId: 'u1', color: '#16A34A', createdAt: ago(380), quota: 25 * 1024 ** 3,
    members: [{ userId: 'u1', role: 'Admin' }, { userId: 'u5', role: 'Organizer' }, { userId: 'u3', role: 'Viewer' }] },
  { id: 't4', name: 'Design Studio', description: 'UI kits, illustrations, mockups and research.', ownerId: 'u4', color: '#EA7A1A', createdAt: ago(200), quota: 75 * 1024 ** 3,
    members: [{ userId: 'u4', role: 'Admin' }, { userId: 'u1', role: 'Viewer' }, { userId: 'u2', role: 'Editor' }] },
];

const TEXT = {
  meeting: `Weekly Operations Sync — Notes\n\nAttendees: Naresh, Priya, Daniel, Marcus\n\n1. Q4 budget review\n   - Marketing spend at 82% of plan\n   - Engineering headcount request approved for 2 roles\n\n2. Vendor renewals\n   - Cloud hosting contract renews Dec 15\n   - Evaluate two alternative suppliers before signing\n\n3. Action items\n   - Naresh: circulate revised budget sheet by Friday\n   - Marcus: reconcile October invoices\n   - Priya: share campaign performance dashboard\n`,
  readme: `Project Handbook\n================\n\nThis folder contains the working files for the Getmeds client portal.\n\nStructure\n---------\n- /Specs        Product requirement documents\n- /Design       Mockups and exported assets\n- /Releases     Release notes and changelogs\n\nConventions\n-----------\nName files as YYYY-MM-DD_Topic_v#. Keep drafts in your personal space\nuntil they are ready for review.\n`,
  todo: `Launch checklist\n\n[x] Finalize pricing page copy\n[x] QA on staging\n[ ] Update help center articles\n[ ] Schedule announcement email\n[ ] Brief support team\n`,
  ideas: `Content ideas for Q1\n\n- Customer story: how Lakeside Co. cut onboarding time by 40%\n- Webinar: organizing team knowledge\n- Checklist: 10 habits of well-organized teams\n- Short video series: tips in 60 seconds\n`,
  doc: `Executive Summary\n\nGetmeds' operations improved steadily through the third quarter. Revenue grew 14% year over year while operating costs were held flat. The customer retention rate reached 93%, the highest level in three years.\n\nKey Highlights\n\n• Launched the self-service portal to 2,400 customers\n• Reduced average ticket resolution time from 19 hours to 11 hours\n• Consolidated three regional warehouses into a single fulfillment hub\n\nOutlook\n\nThe fourth quarter will focus on expanding the partner program and completing the migration to the new billing platform.`,
  policy: `Remote Work Policy\n\n1. Purpose\nThis policy outlines expectations for employees who work remotely, fully or in part.\n\n2. Eligibility\nAll full-time employees who have completed their probation period are eligible.\n\n3. Equipment\nThe company provides a laptop, monitor and a monthly connectivity stipend.\n\n4. Security\nEmployees must use the company VPN and store work files only in approved team folders.`,
};

let n = 0;
const items = [];
function add(o) {
  const id = o.id || `i${++n}`;
  const isFolder = !o.ext;
  items.push({
    id,
    name: o.name,
    type: isFolder ? 'folder' : 'file',
    ext: o.ext || '',
    size: isFolder ? 0 : o.size ?? 120000,
    parentId: o.parentId ?? null,
    space: o.space || 'my',
    ownerId: o.ownerId || ME,
    createdAt: o.createdAt || ago(o.age ?? 30) - 3 * D,
    modifiedAt: o.modifiedAt || ago(o.age ?? 30, o.hrs || 0),
    modifiedBy: o.modifiedBy || o.ownerId || ME,
    lastOpened: o.opened ? ago(o.opened[0], o.opened[1] || 0) : null,
    favorite: !!o.fav,
    trashed: !!o.trashedAt,
    trashedAt: o.trashedAt || null,
    trashedBy: o.trashedAt ? ME : null,
    sharedWith: o.sharedWith || [],
    link: o.link || null,
    content: o.content ?? null,
    thumb: o.thumb || null,
    description: o.description || '',
    version: o.versions ? o.versions.length + 1 : 1,
    versions: (o.versions || []).slice().sort((a, b) => b.no - a.no), // newest first, like the live history
    comments: o.comments || [],
    lock: o.lock || null,
  });
  return id;
}

// ---- Collaboration seeds: version history, comments, locks ----
const ver = (no, by, days, size, note, content) => ({ id: `v${no}-${days}`, no, at: ago(days), by, size, note, content: content ?? null, sheet: null, slides: null, dataUrl: null, hasBlob: false });
let cn = 0;
const cm = (userId, text, days, hrs = 0, extra = {}) => ({
  id: `c${++cn}`, userId, text, at: ago(days, hrs), parentId: null, resolved: false, resolvedBy: null, resolvedAt: null, editedAt: null,
  mentions: USERS.filter((u) => text.includes(`@${u.name}`)).map((u) => u.id),
  ...extra,
});
const reply = (parent, userId, text, days, hrs = 0) => cm(userId, text, days, hrs, { parentId: parent.id });

const sw = (...pairs) => pairs.map(([userId, role]) => ({ userId, role, sharedAt: ago(5), sharedBy: ME }));

// ---------- My Folders ----------
const projects = add({ name: 'Projects', age: 1, fav: true });
const portal = add({ name: 'Client Portal', parentId: projects, age: 1 });
const prC1 = cm('u3', '@Naresh Kumar Bishnoi should SSO be in scope for phase 1, or can it wait for the next release?', 2, 3);
const prC2 = cm('u4', 'The onboarding flow section needs the updated wireframes. I will attach v4 once it is reviewed.', 1, 6);
add({ name: 'Portal Requirements.docx', ext: 'docx', size: 248_300, parentId: portal, age: 1, hrs: 2, content: TEXT.doc, opened: [0, 3],
  versions: [
    ver(1, ME, 9, 182_000, 'Initial draft', 'Executive Summary\n\nDraft outline for the client portal. Sections to be filled in.'),
    ver(2, 'u3', 5, 231_500, 'Added scope and timeline', 'Executive Summary\n\nThe client portal gives customers self-service access to orders, invoices and support.\n\nScope\n\n• Order history\n• Invoice downloads\n• Support tickets'),
  ],
  comments: [prC1, reply(prC1, ME, 'Phase 1 — keep SAML for later. @Daniel Kim please update the scope table.', 2, 1), prC2] });
add({ name: 'Sprint Timeline.xlsx', ext: 'xlsx', size: 96_400, parentId: portal, age: 3 });
add({ name: 'Wireframes v3.png', ext: 'png', size: 1_840_000, parentId: portal, age: 4, thumb: 'gen:7' });
add({ name: 'README.txt', ext: 'txt', size: 812, parentId: portal, age: 6, content: TEXT.readme });
const website = add({ name: 'Website Redesign', parentId: projects, age: 8, sharedWith: sw(['u4', 'editor'], ['u2', 'viewer']) });
add({ name: 'Homepage Hero.jpg', ext: 'jpg', size: 2_430_000, parentId: website, age: 8, thumb: 'gen:3' });
add({ name: 'Sitemap.pdf', ext: 'pdf', size: 412_000, parentId: website, age: 9, content: TEXT.readme });
add({ name: 'Brand Icons.svg', ext: 'svg', size: 18_200, parentId: website, age: 12, thumb: 'gen:11' });
add({ name: 'Archive 2023', parentId: projects, age: 120 });

const reports = add({ name: 'Reports', age: 2 });
const q3C1 = cm('u3', 'Can we add the regional split?', 0, 4);
const q3C2 = cm('u5', 'Numbers on page 3 match the finance close. Good to go from my side.', 1, 2, { resolved: true, resolvedBy: ME, resolvedAt: ago(1) });
const q3Review = add({ name: 'Q3 Business Review.pdf', ext: 'pdf', size: 3_210_000, parentId: reports, age: 2, content: TEXT.doc, fav: true, opened: [0, 1], sharedWith: sw(['u3', 'viewer'], ['u5', 'commenter']), link: { enabled: true, access: 'org', role: 'viewer', expires: null, password: false },
  versions: [ver(1, ME, 6, 2_870_000, 'First export for review', 'Executive Summary\n\nDraft — figures pending the finance close.')],
  comments: [q3C2, q3C1] });
add({ name: 'Monthly KPIs - October.xlsx', ext: 'xlsx', size: 184_000, parentId: reports, age: 7, opened: [1, 2] });
add({ name: 'Board Deck Q3.pptx', ext: 'pptx', size: 8_920_000, parentId: reports, age: 10, sharedWith: sw(['u3', 'editor']) });
add({ name: 'Customer Survey Results.xls', ext: 'xls', size: 642_000, parentId: reports, age: 22 });

const personal = add({ name: 'Personal', age: 15 });
add({ name: 'Travel Itinerary.pdf', ext: 'pdf', size: 210_000, parentId: personal, age: 15, content: 'Travel Itinerary\n\nFlight NW 204 — Departs 08:40, Arrives 11:15\nHotel: Harbor View Suites, 3 nights\nConference: Cloud Ops Summit, Hall B' });
add({ name: 'Profile Photo.jpg', ext: 'jpg', size: 980_000, parentId: personal, age: 40, thumb: 'gen:5' });

const media = add({ name: 'Media Assets', age: 5 });
add({ name: 'Product Walkthrough.mp4', ext: 'mp4', size: 48_600_000, parentId: media, age: 5, opened: [2, 0] });
add({ name: 'Team Offsite.jpg', ext: 'jpg', size: 3_100_000, parentId: media, age: 14, thumb: 'gen:4', fav: true });
add({ name: 'Booth Banner.png', ext: 'png', size: 1_220_000, parentId: media, age: 18, thumb: 'gen:2' });
add({ name: 'Logo Pack.zip', ext: 'zip', size: 12_400_000, parentId: media, age: 20 });

add({ name: 'Meeting Notes.txt', ext: 'txt', size: 1_204, age: 0, hrs: 2, content: TEXT.meeting, opened: [0, 2], fav: true,
  versions: [ver(1, ME, 1, 486, 'Agenda only', 'Weekly Operations Sync — Agenda\n\n1. Q4 budget review\n2. Vendor renewals\n3. Action items\n')] });
add({ name: 'Annual Budget 2026.xlsx', ext: 'xlsx', size: 356_000, age: 1, hrs: 5, opened: [0, 6], sharedWith: sw(['u5', 'editor']), lock: { by: ME, at: ago(0, 5) } });
add({ name: 'Company Overview.pptx', ext: 'pptx', size: 5_420_000, age: 3, sharedWith: sw(['u2', 'viewer'], ['u6', 'viewer']), link: { enabled: true, access: 'anyone', role: 'viewer', expires: ago(-14), password: true } });
add({ name: 'Remote Work Policy.docx', ext: 'docx', size: 88_000, age: 6, content: TEXT.policy });
add({ name: 'Contract Template.doc', ext: 'doc', size: 64_000, age: 25 });
add({ name: 'Launch Checklist.txt', ext: 'txt', size: 420, age: 4, content: TEXT.todo });
add({ name: 'Signed NDA.pdf', ext: 'pdf', size: 154_000, age: 33, content: 'Mutual Non-Disclosure Agreement\n\nThis agreement is entered into by Getmeds and Lakeside Co.\n\nSigned electronically.' });
add({ name: 'Screenshot 2026-11-02.png', ext: 'png', size: 640_000, age: 9, thumb: 'gen:13' });

// ---------- Team folders ----------
const mCamp = add({ name: 'Campaigns', space: 't1', ownerId: 'u2', age: 2 });
const hcC1 = cm('u6', 'Love the customer story angle. @Priya Sharma do we have sign-off from Lakeside Co. to use their name?', 2, 5);
add({ name: 'Holiday Campaign Brief.docx', ext: 'docx', size: 120_000, parentId: mCamp, space: 't1', ownerId: 'u2', age: 2, content: TEXT.ideas, opened: [1, 0],
  versions: [ver(1, 'u2', 6, 64_000, 'Kick-off notes', 'Holiday campaign — kick-off\n\nGoals, audience and channels to be agreed.')],
  comments: [hcC1, reply(hcC1, 'u2', 'Yes, legal approved it yesterday.', 2, 2)] });
add({ name: 'Ad Creative A.png', ext: 'png', size: 1_540_000, parentId: mCamp, space: 't1', ownerId: 'u6', age: 3, thumb: 'gen:4' });
add({ name: 'Ad Creative B.png', ext: 'png', size: 1_610_000, parentId: mCamp, space: 't1', ownerId: 'u6', age: 3, thumb: 'gen:6' });
add({ name: 'Campaign Budget.xlsx', ext: 'xlsx', size: 76_000, parentId: mCamp, space: 't1', ownerId: 'u2', age: 4 });
const mBrand = add({ name: 'Brand Guidelines', space: 't1', ownerId: 'u2', age: 30 });
add({ name: 'Brand Book 2026.pdf', ext: 'pdf', size: 14_200_000, parentId: mBrand, space: 't1', ownerId: 'u2', age: 30, content: 'Brand Book\n\nVoice: clear, warm, confident.\nPrimary color: Ocean Blue.\nTypeface: Inter.' });
add({ name: 'Color Palette.svg', ext: 'svg', size: 9_800, parentId: mBrand, space: 't1', ownerId: 'u4', age: 31, thumb: 'gen:12' });
add({ name: 'Content Calendar.xlsx', ext: 'xlsx', size: 112_000, space: 't1', ownerId: 'u6', age: 1 });
add({ name: 'Content Ideas.txt', ext: 'txt', size: 360, space: 't1', ownerId: 'u6', age: 6, content: TEXT.ideas });

const pSpecs = add({ name: 'Specs', space: 't2', ownerId: 'u3', age: 3 });
add({ name: 'Search Revamp PRD.docx', ext: 'docx', size: 210_000, parentId: pSpecs, space: 't2', ownerId: 'u3', age: 3, content: TEXT.doc,
  lock: { by: 'u3', at: ago(0, 2) },
  versions: [
    ver(1, 'u3', 14, 96_000, 'Problem statement', 'Search Revamp\n\nProblem: users cannot find files by content.'),
    ver(2, 'u7', 8, 158_000, 'Added indexing approach', 'Search Revamp\n\nProblem: users cannot find files by content.\n\nApproach: full-text index updated on upload.'),
  ],
  comments: [cm('u7', 'Indexing latency target should be under 5 seconds after upload.', 3, 4)] });
add({ name: 'API Design.pdf', ext: 'pdf', size: 820_000, parentId: pSpecs, space: 't2', ownerId: 'u7', age: 5, content: 'REST API Design\n\nGET /v1/files\nPOST /v1/files\nPATCH /v1/files/{id}\nDELETE /v1/files/{id}' });
const pRel = add({ name: 'Releases', space: 't2', ownerId: 'u3', age: 1 });
add({ name: 'Release Notes 4.2.txt', ext: 'txt', size: 2_100, parentId: pRel, space: 't2', ownerId: 'u7', age: 1, content: 'Release 4.2\n\n- New: bulk move & copy\n- Improved: search relevance\n- Fixed: upload retries on flaky networks',
  versions: [ver(1, 'u7', 3, 1_400, 'Draft', 'Release 4.2\n\n- New: bulk move & copy\n- Improved: search relevance')] });
add({ name: 'Demo Recording.mp4', ext: 'mp4', size: 126_000_000, parentId: pRel, space: 't2', ownerId: 'u3', age: 2 });
add({ name: 'Architecture Overview.pptx', ext: 'pptx', size: 4_300_000, space: 't2', ownerId: 'u3', age: 12 });
const buildArtifacts = add({ name: 'Build Artifacts.zip', ext: 'zip', size: 88_000_000, space: 't2', ownerId: 'u7', age: 2 });

const fInv = add({ name: 'Invoices', space: 't3', age: 2 });
add({ name: 'INV-10482.pdf', ext: 'pdf', size: 98_000, parentId: fInv, space: 't3', ownerId: 'u5', age: 2, content: 'Invoice INV-10482\n\nAmount due: $12,400.00\nTerms: Net 30' });
add({ name: 'INV-10483.pdf', ext: 'pdf', size: 101_000, parentId: fInv, space: 't3', ownerId: 'u5', age: 2, content: 'Invoice INV-10483\n\nAmount due: $3,150.00\nTerms: Net 15' });
add({ name: 'Vendor Contracts', space: 't3', age: 40 });
add({ name: 'FY26 Forecast.xlsx', ext: 'xlsx', size: 540_000, space: 't3', ownerId: 'u5', age: 1, opened: [0, 8] });

const dKit = add({ name: 'UI Kit', space: 't4', ownerId: 'u4', age: 6 });
add({ name: 'Components.svg', ext: 'svg', size: 220_000, parentId: dKit, space: 't4', ownerId: 'u4', age: 6, thumb: 'gen:8' });
add({ name: 'Dashboard Mockup.png', ext: 'png', size: 2_900_000, space: 't4', ownerId: 'u4', age: 4, thumb: 'gen:10' });
add({ name: 'User Research Findings.docx', ext: 'docx', size: 160_000, space: 't4', ownerId: 'u4', age: 9, content: TEXT.doc });

// ---------- Shared with me (owned by other users) ----------
const swm = (role, by) => [{ userId: ME, role, sharedAt: ago(2), sharedBy: by }];
const s1 = add({ name: 'Hiring Plan 2026', space: 'user', ownerId: 'u8', age: 3, sharedWith: swm('editor', 'u8') });
add({ name: 'Interview Guide.docx', ext: 'docx', size: 74_000, parentId: s1, space: 'user', ownerId: 'u8', age: 3, content: TEXT.policy });
add({ name: 'Open Roles.xlsx', ext: 'xlsx', size: 42_000, parentId: s1, space: 'user', ownerId: 'u8', age: 4 });
const partnerPitch = add({ name: 'Partner Pitch.pptx', ext: 'pptx', size: 6_800_000, space: 'user', ownerId: 'u2', age: 1, sharedWith: swm('commenter', 'u2'),
  comments: [cm('u2', '@Naresh Kumar Bishnoi could you review slides 3–5 before Friday? Comments are enough, no need to edit.', 1, 1)] });
add({ name: 'Expense Report Oct.xlsx', ext: 'xlsx', size: 58_000, space: 'user', ownerId: 'u5', age: 2, sharedWith: swm('viewer', 'u5'), opened: [1, 4] });
add({ name: 'Infra Cost Analysis.pdf', ext: 'pdf', size: 1_100_000, space: 'user', ownerId: 'u7', age: 6, sharedWith: swm('viewer', 'u7'), content: TEXT.doc });
add({ name: 'Moodboard.jpg', ext: 'jpg', size: 2_200_000, space: 'user', ownerId: 'u4', age: 7, sharedWith: swm('viewer', 'u4'), thumb: 'gen:1' });
add({ name: 'Onboarding Video.mp4', ext: 'mp4', size: 64_000_000, space: 'user', ownerId: 'u6', age: 11, sharedWith: swm('viewer', 'u6') });

// ---------- Trash ----------
add({ name: 'Old Logo Draft.png', ext: 'png', size: 820_000, parentId: media, age: 50, thumb: 'gen:14', trashedAt: ago(3) });
add({ name: 'Unused Assets', age: 60, trashedAt: ago(6) });
add({ name: 'Draft Proposal v1.docx', ext: 'docx', size: 92_000, parentId: reports, age: 45, trashedAt: ago(1) });
add({ name: 'temp-notes.txt', ext: 'txt', size: 140, age: 20, trashedAt: ago(9), content: 'temporary notes' });

// ---------- A photographed receipt (an image with text, for OCR) — appended last so earlier ids stay stable ----------
const receiptLine = (y, left, right = '', size = 16, weight = 400) => `<text x='34' y='${y}' font-size='${size}' font-weight='${weight}'>${left}</text>${right ? `<text x='386' y='${y}' font-size='${size}' font-weight='${weight}' text-anchor='end'>${right}</text>` : ''}`;
const RECEIPT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='600' viewBox='0 0 420 600'><rect width='420' height='600' fill='#fdfcf8'/><g font-family='Courier New, Courier, monospace' fill='#1f1f1f'>`
  + `<text x='210' y='58' font-size='28' font-weight='700' text-anchor='middle'>HARBOR CAFE</text><text x='210' y='86' font-size='15' text-anchor='middle'>12 Bayfront Avenue, Manila</text>`
  + `<text x='210' y='128' font-size='19' font-weight='700' text-anchor='middle'>RECEIPT</text>`
  + receiptLine(172, 'Receipt No: RC-20418') + receiptLine(198, 'Date: Nov 14, 2026')
  + receiptLine(250, 'Flat white x2', '$9.00') + receiptLine(276, 'Club sandwich', '$14.50') + receiptLine(302, 'Caesar salad', '$12.80') + receiptLine(328, 'Sparkling water x2', '$7.88')
  + receiptLine(372, 'Subtotal', '$44.18') + receiptLine(398, 'Service tax 10%', '$4.42') + receiptLine(440, 'TOTAL', '$48.60', 20, 700)
  + `<text x='210' y='492' font-size='16' text-anchor='middle'>PAID IN FULL - VISA 4417</text><text x='210' y='540' font-size='15' text-anchor='middle'>Thank you for visiting!</text></g></svg>`;
add({ name: 'Receipt - Harbor Cafe.png', ext: 'png', size: 186_400, parentId: personal, age: 6, opened: [5, 2] });
items[items.length - 1].dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(RECEIPT_SVG)}`;
items[items.length - 1].mime = 'image/png';

// ---------- Files containing (fake, test-format) sensitive data, for data loss prevention ----------
add({ name: 'Vendor payment details.txt', ext: 'txt', size: 412, age: 3, content: 'Vendor payment details - Lakeside Print Co.\n\nCorporate card on file: 4111 1111 1111 1111 (exp 08/28)\nIBAN: GB82 WEST 1234 5698 7654 32\nAccount number: 0012 3456 7890\nBilling contact: billing@lakeside.example\n\nUse for monthly print orders only.',
  link: { enabled: true, access: 'anyone', role: 'viewer', expires: null, password: false } });
add({ name: 'Payroll export - November.txt', ext: 'txt', size: 980, space: 't-finance', ownerId: 'u5', age: 1, content: 'Payroll export - November 2026\n\nName | TIN | SSS | Email | Mobile\nAna Reyes | 123-456-789-000 | 34-1234567-8 | ana.reyes@getmeds.ph | 0917 123 4567\nBen Cruz | 234-567-890-000 | 34-2345678-9 | ben.cruz@getmeds.ph | 0918 234 5678\nCara Lim | 345-678-901-000 | 34-3456789-0 | cara.lim@getmeds.ph | 0919 345 6789\nDan Santos | 456-789-012-000 | 34-4567890-1 | dan.santos@getmeds.ph | 0920 456 7890\nEla Garcia | 567-890-123-000 | 34-5678901-2 | ela.garcia@getmeds.ph | 0921 567 8901\nFinn Tan | 678-901-234-000 | 34-6789012-3 | finn.tan@getmeds.ph | 0922 678 9012' });

// ---------- Organization seeds: labels, folder colours, custom fields ----------
export const LABELS = [
  { id: 'lb-confidential', name: 'Confidential', color: '#DC2626' },
  { id: 'lb-approved', name: 'Approved', color: '#16A34A' },
  { id: 'lb-draft', name: 'Draft', color: '#A16207' },
  { id: 'lb-urgent', name: 'Urgent', color: '#EA580C' },
  { id: 'lb-client', name: 'Client-facing', color: '#1686D9' },
  { id: 'lb-review', name: 'Needs review', color: '#7C3AED' },
];

export const DATA_TEMPLATES = [
  { id: 'dt-invoice', name: 'Invoice', description: 'Payables and receivables.', fields: [
    { id: 'f-invno', name: 'Invoice no.', type: 'text' },
    { id: 'f-vendor', name: 'Vendor', type: 'text' },
    { id: 'f-amount', name: 'Amount', type: 'number' },
    { id: 'f-due', name: 'Due date', type: 'date' },
    { id: 'f-status', name: 'Status', type: 'select', options: ['Unpaid', 'Paid', 'Overdue'] },
  ] },
  { id: 'dt-contract', name: 'Contract', description: 'Agreements with partners, vendors and clients.', fields: [
    { id: 'f-party', name: 'Counterparty', type: 'text' },
    { id: 'f-start', name: 'Start date', type: 'date' },
    { id: 'f-end', name: 'End date', type: 'date' },
    { id: 'f-value', name: 'Contract value', type: 'number' },
    { id: 'f-cstatus', name: 'Status', type: 'select', options: ['Draft', 'Under review', 'Signed', 'Expired'] },
  ] },
  { id: 'dt-filing', name: 'Regulatory filing', description: 'Registrations, permits and agency submissions.', fields: [
    { id: 'f-agency', name: 'Agency', type: 'text' },
    { id: 'f-ref', name: 'Reference no.', type: 'text' },
    { id: 'f-submitted', name: 'Submitted on', type: 'date' },
    { id: 'f-fstatus', name: 'Status', type: 'select', options: ['Preparing', 'Submitted', 'Approved', 'Rejected'] },
  ] },
];

const isoDay = (daysFromNow) => new Date(NOW + daysFromNow * D).toISOString().slice(0, 10);
const ORGANIZE = {
  'Projects': { color: '#6366F1' },
  'Reports': { color: '#16A34A' },
  'Personal': { color: '#DB2777' },
  'Portal Requirements.docx': { labels: ['lb-review', 'lb-client'] },
  'Q3 Business Review.pdf': { labels: ['lb-approved', 'lb-confidential'] },
  'Board Deck Q3.pptx': { labels: ['lb-confidential'] },
  'Annual Budget 2026.xlsx': { labels: ['lb-draft', 'lb-confidential'] },
  'Company Overview.pptx': { labels: ['lb-client', 'lb-approved'] },
  'Launch Checklist.txt': { labels: ['lb-urgent'] },
  'Holiday Campaign Brief.docx': { labels: ['lb-draft'] },
  'Search Revamp PRD.docx': { labels: ['lb-review'] },
  'INV-10482.pdf': { labels: ['lb-urgent'], meta: { templateId: 'dt-invoice', values: { 'f-invno': 'INV-10482', 'f-vendor': 'Harbor Cloud Hosting', 'f-amount': 12400, 'f-due': isoDay(5), 'f-status': 'Unpaid' } } },
  'INV-10483.pdf': { meta: { templateId: 'dt-invoice', values: { 'f-invno': 'INV-10483', 'f-vendor': 'Lakeside Print Co.', 'f-amount': 3150, 'f-due': isoDay(-3), 'f-status': 'Paid' } } },
  'Signed NDA.pdf': { labels: ['lb-confidential'], meta: { templateId: 'dt-contract', values: { 'f-party': 'Lakeside Co.', 'f-start': isoDay(-33), 'f-end': isoDay(332), 'f-cstatus': 'Signed' } } },
  'Contract Template.doc': { meta: { templateId: 'dt-contract', values: { 'f-cstatus': 'Draft' } } },
};
for (const it of items) {
  const o = ORGANIZE[it.name];
  it.labels = o?.labels || [];
  it.color = o?.color || null;
  it.meta = o?.meta || null;
}

// ---------- Sharing seeds: link options, link access logs, file requests ----------
/** Fill in link options added later (view-only, download limit, watermark, password). */
export const normalizeLink = (link) => {
  if (!link) return null;
  // Passwords are stored hashed (secretHash, see src/data/storage/secrets.js); a plain `secret` only
  // survives until the start-up migration hashes it.
  const { secret, ...rest } = link;
  return { allowDownload: true, maxDownloads: null, downloads: 0, watermark: false, secretHash: null, ...rest, ...(secret ? { secret } : {}) };
};

/** PBKDF2 digest of the sample link password "getmeds2026" (so the seed holds no plain-text password). */
export const SAMPLE_LINK_SECRET_HASH = { alg: 'pbkdf2-sha256', iter: 150000, salt: 'TMfAY+4tNM2KgphgSuBp/w==', hash: 'mIJAUVcn8zfPKpPVDeGraNoUX7+5X4xrGqTUODUH9co=' };

let ln = 0;
const visit = (days, hrs, event, who = null, extra = {}) => ({ id: `la${++ln}`, at: ago(days, hrs), event, who, ip: `203.0.113.${20 + ln * 7}`, device: extra.device || 'Chrome on Windows', ...extra });
const SHARING = {
  'Q3 Business Review.pdf': {
    link: { watermark: true },
    linkLog: [
      visit(0, 3, 'viewed', { name: 'Marcus Lee', email: 'marcus.lee@getmeds.ph' }),
      visit(0, 5, 'downloaded', { name: 'Daniel Kim', email: 'daniel.kim@getmeds.ph' }, { device: 'Safari on macOS' }),
      visit(1, 1, 'viewed', { name: 'Daniel Kim', email: 'daniel.kim@getmeds.ph' }, { device: 'Safari on macOS' }),
    ],
  },
  'Company Overview.pptx': {
    link: { secretHash: SAMPLE_LINK_SECRET_HASH, maxDownloads: 10, downloads: 3, watermark: true },
    linkLog: [
      visit(0, 2, 'viewed', null, { device: 'Edge on Windows' }),
      visit(0, 2, 'password-failed', null, { device: 'Edge on Windows' }),
      visit(1, 6, 'downloaded', null, { device: 'Chrome on Android' }),
      visit(1, 6, 'viewed', null, { device: 'Chrome on Android' }),
      visit(2, 4, 'downloaded', null, { device: 'Firefox on Linux' }),
      visit(3, 1, 'downloaded', null, { device: 'Chrome on Windows' }),
    ],
  },
};
for (const it of items) {
  const o = SHARING[it.name];
  it.link = normalizeLink(it.link && { ...it.link, ...(o?.link || {}) });
  it.linkLog = o?.linkLog || [];
  it.uploadedBy = null;
}
// INV-10483 arrived through the vendor file request below.
const viaRequest = items.find((i) => i.name === 'INV-10483.pdf');
viaRequest.uploadedBy = { name: 'Lakeside Print Co.', email: 'billing@lakeside.example', requestId: 'fr-vendor-invoices' };

export const FILE_REQUESTS = [
  {
    id: 'fr-vendor-invoices', folderId: fInv, title: 'Vendor invoices — November',
    message: 'Please upload your November invoice as a PDF. Use your invoice number as the file name.',
    createdBy: ME, createdAt: ago(6), expires: ago(-24), secretHash: null, requireIdentity: true, enabled: true,
    uploads: [{ id: 'ru1', name: 'Lakeside Print Co.', email: 'billing@lakeside.example', at: ago(2, 3), fileIds: [viaRequest.id], fileNames: ['INV-10483.pdf'] }],
  },
  {
    id: 'fr-hiring', folderId: projects, title: 'Portfolio samples for the design role',
    message: 'Share up to 5 work samples (PDF or images). Large files are fine.',
    createdBy: ME, createdAt: ago(12), expires: ago(2), secretHash: null, requireIdentity: true, enabled: true, uploads: [],
  },
];

// ---------- Productivity seeds: tasks and approvals on files ----------
const idByName = (name) => items.find((i) => i.name === name)?.id;
const endOfDay = (daysFromNow) => { const d = new Date(NOW + daysFromNow * D); d.setHours(23, 59, 0, 0); return d.getTime(); };
const task = (id, itemName, title, assigneeId, createdBy, dueIn, priority = 'normal', extra = {}) => ({
  id, itemId: idByName(itemName), title, note: '', assigneeId, createdBy, createdAt: ago(4), due: dueIn == null ? null : endOfDay(dueIn),
  priority, status: 'open', completedAt: null, completedBy: null, ...extra,
});
export const TASKS = [
  task('tk1', 'Q3 Business Review.pdf', 'Add the regional split to page 4', ME, 'u3', 1, 'high', { note: 'Marketing needs APAC vs EMEA before the board pack goes out.' }),
  task('tk2', 'Campaign Budget.xlsx', 'Sign off the holiday budget', ME, 'u2', -2, 'normal'),
  task('tk3', 'Annual Budget 2026.xlsx', 'Add Q4 hiring targets', ME, 'u5', null, 'low'),
  task('tk4', 'Portal Requirements.docx', 'Update the scope table for SSO', 'u3', ME, 3, 'normal'),
  task('tk5', 'INV-10482.pdf', 'Confirm payment terms with Harbor Cloud', 'u5', ME, -1, 'high'),
  task('tk6', 'Signed NDA.pdf', 'File the countersigned NDA', ME, ME, -20, 'normal', { status: 'done', completedAt: ago(19), completedBy: ME }),
];

const appr = (id, itemName, requestedBy, approvers, extra = {}) => ({
  id, itemId: idByName(itemName), requestedBy, requestedAt: ago(3), due: null, message: '', mode: 'all', applyLabel: true,
  status: 'pending', decidedAt: null, version: items.find((i) => i.name === itemName)?.version || 1,
  approvers: approvers.map(([userId, decision = 'pending', days = null, comment = '']) => ({ userId, decision, at: days == null ? null : ago(days), comment })),
  ...extra,
});
export const APPROVALS = [
  appr('ap1', 'Holiday Campaign Brief.docx', 'u2', [[ME], ['u6', 'approved', 1, 'Copy reads well.']], { due: endOfDay(2), message: 'Final copy for the holiday push. Please approve by Friday so we can brief the agency.' }),
  appr('ap2', 'Search Revamp PRD.docx', 'u3', [[ME]], { mode: 'any', due: endOfDay(5), message: 'Ready for sign-off on the indexing approach.' }),
  appr('ap3', 'Company Overview.pptx', ME, [['u3', 'approved', 1], ['u5']], { due: endOfDay(4), message: 'Updated deck for the partner meeting.' }),
  appr('ap4', 'Q3 Business Review.pdf', ME, [['u3', 'approved', 2, 'Numbers check out.']], { mode: 'any', status: 'approved', decidedAt: ago(2), requestedAt: ago(5) }),
  appr('ap5', 'Contract Template.doc', ME, [['u5', 'rejected', 6, 'The liability clause needs legal review first.']], { status: 'rejected', decidedAt: ago(6), requestedAt: ago(9) }),
];

// ---------- E-signature seeds ----------
const AGREEMENT = `VENDOR SERVICES AGREEMENT

This Vendor Services Agreement is made between Getmeds Philippines, Inc. ("Client") and
Lakeside Print Co. ("Vendor").

1. Services. Vendor will print and deliver marketing collateral as described in each purchase order.
2. Term. This agreement starts on the date of the last signature and runs for twelve (12) months.
3. Fees. Client pays the fees listed in each purchase order within thirty (30) days of invoice.
4. Quality. Vendor will reprint, at no cost, any item that does not match the approved proof.
5. Confidentiality. Each party keeps the other party's non-public information confidential.
6. Termination. Either party may end this agreement with thirty (30) days' written notice.

Signed by the authorised representatives of each party.


CLIENT: Getmeds Philippines, Inc.



VENDOR: Lakeside Print Co.`;
const OFFER = `OFFER OF EMPLOYMENT

Dear Grace,

We are pleased to offer you the position of HR Partner at Getmeds Philippines, Inc.

Start date: the first Monday of next month
Location: Makati office (hybrid, three days on site)
Reporting to: Naresh Kumar Bishnoi, Administrator
Compensation: as set out in the attached schedule

Please sign below to accept this offer. We look forward to working with you.


ACCEPTED BY:`;
add({ name: 'Vendor Services Agreement.pdf', ext: 'pdf', size: 186_000, space: 't-finance', ownerId: 'u5', age: 1, content: AGREEMENT });
add({ name: 'Offer Letter - Grace Liu.pdf', ext: 'pdf', size: 92_000, space: 't-hr', age: 2, content: OFFER });
export const SIGN_ITEM_NAMES = ['Vendor Services Agreement.pdf', 'Offer Letter - Grace Liu.pdf'];

const signer = (id, who, order, color, status, extra = {}) => ({
  id, userId: who.userId || null, name: who.name, email: who.email, order, color, status,
  sentAt: status === 'waiting' ? null : ago(3), viewedAt: null, signedAt: null, declinedAt: null, reason: '', device: '', ip: '', ...extra,
});
const fld = (id, signerId, kind, page, x, y, w, h, value = null) => ({ id, signerId, kind, page, x, y, w, h, value });
const meWho = { userId: ME, name: USERS[0].name, email: USERS[0].email };
const userWho = (id) => { const u = USERS.find((x) => x.id === id); return { userId: id, name: u.name, email: u.email }; };
const sreq = (id, itemName, createdBy, o) => ({
  id, itemId: idByName(itemName), version: items.find((i) => i.name === itemName)?.version || 1, title: o.title, message: o.message || '',
  createdBy, createdAt: o.createdAt || ago(3), due: o.due ?? null, sequential: !!o.sequential, status: o.status, completedAt: o.completedAt || null, signedFileId: null,
  signers: o.signers, fields: o.fields, events: o.events,
});
export const SIGN_REQUESTS = [
  sreq('sr1', 'Vendor Services Agreement.pdf', 'u5', {
    title: 'Please sign: Vendor Services Agreement', message: 'Legal has approved the final wording. Please sign first; Lakeside signs after you.',
    createdAt: ago(0, 6), due: endOfDay(3), sequential: true, status: 'sent',
    signers: [
      signer('sg1a', meWho, 1, '#1686D9', 'sent', { sentAt: ago(0, 6) }),
      signer('sg1b', { name: 'Rosa Delgado', email: 'rosa.delgado@lakeside.example' }, 2, '#D946EF', 'waiting'),
    ],
    fields: [
      fld('f1a1', 'sg1a', 'signature', 1, 0.09, 0.456, 0.3, 0.05), fld('f1a2', 'sg1a', 'date', 1, 0.45, 0.474, 0.18, 0.03),
      fld('f1b1', 'sg1b', 'signature', 1, 0.09, 0.528, 0.3, 0.05), fld('f1b2', 'sg1b', 'name', 1, 0.45, 0.546, 0.24, 0.03), fld('f1b3', 'sg1b', 'date', 1, 0.72, 0.546, 0.18, 0.03),
    ],
    events: [{ at: ago(0, 6), kind: 'created', by: 'u5', detail: '2 signers, in order' }],
  }),
  sreq('sr2', 'Offer Letter - Grace Liu.pdf', ME, {
    title: 'Offer letter for your signature', message: 'Welcome aboard, Grace! Please review and sign to accept.', createdAt: ago(1, 2), due: endOfDay(5), status: 'viewed',
    signers: [signer('sg2a', userWho('u8'), 1, '#1686D9', 'viewed', { sentAt: ago(1, 2), viewedAt: ago(0, 3), device: 'Chrome on Windows', ip: '203.0.113.88' })],
    fields: [fld('f2a1', 'sg2a', 'signature', 1, 0.09, 0.368, 0.3, 0.055), fld('f2a2', 'sg2a', 'name', 1, 0.45, 0.39, 0.24, 0.03), fld('f2a3', 'sg2a', 'date', 1, 0.72, 0.39, 0.18, 0.03)],
    events: [{ at: ago(1, 2), kind: 'created', by: ME, detail: '1 signer' }, { at: ago(0, 3), kind: 'viewed', signerId: 'sg2a' }],
  }),
  sreq('sr3', 'Signed NDA.pdf', ME, {
    title: 'Mutual NDA — Lakeside Co.', createdAt: ago(35), status: 'signed', completedAt: ago(33),
    signers: [
      signer('sg3a', { name: 'Tom Becker', email: 'tom.becker@lakeside.example' }, 1, '#1686D9', 'signed', { sentAt: ago(35), viewedAt: ago(34), signedAt: ago(34), device: 'Safari on macOS', ip: '198.51.100.12' }),
      signer('sg3b', meWho, 2, '#D946EF', 'signed', { sentAt: ago(35), viewedAt: ago(33), signedAt: ago(33), device: 'Chrome on Windows', ip: '203.0.113.42' }),
    ],
    fields: [
      fld('f3a1', 'sg3a', 'signature', 1, 0.09, 0.3, 0.3, 0.06, { type: 'typed', text: 'Tom Becker', font: 'vibes' }),
      fld('f3a2', 'sg3a', 'date', 1, 0.09, 0.37, 0.18, 0.03, new Date(ago(34)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })),
      fld('f3b1', 'sg3b', 'signature', 1, 0.55, 0.3, 0.3, 0.06, { type: 'typed', text: USERS[0].name, font: 'dancing' }),
      fld('f3b2', 'sg3b', 'date', 1, 0.55, 0.37, 0.18, 0.03, new Date(ago(33)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })),
    ],
    events: [
      { at: ago(35), kind: 'created', by: ME, detail: '2 signers' }, { at: ago(34), kind: 'viewed', signerId: 'sg3a' }, { at: ago(34), kind: 'signed', signerId: 'sg3a' },
      { at: ago(33), kind: 'viewed', signerId: 'sg3b' }, { at: ago(33), kind: 'signed', signerId: 'sg3b' }, { at: ago(33), kind: 'completed' },
    ],
  }),
  sreq('sr4', 'Brand Book 2026.pdf', ME, {
    title: 'Sign-off: Brand Book 2026', createdAt: ago(8), status: 'declined',
    signers: [signer('sg4a', userWho('u2'), 1, '#1686D9', 'declined', { sentAt: ago(8), viewedAt: ago(7), declinedAt: ago(7), reason: 'Please wait for v2 — the colour section is still changing.', device: 'Chrome on Windows', ip: '203.0.113.77' })],
    fields: [fld('f4a1', 'sg4a', 'signature', 1, 0.09, 0.4, 0.3, 0.06)],
    events: [{ at: ago(8), kind: 'created', by: ME, detail: '1 signer' }, { at: ago(7), kind: 'viewed', signerId: 'sg4a' }, { at: ago(7), kind: 'declined', signerId: 'sg4a', detail: 'Please wait for v2 — the colour section is still changing.' }],
  }),
].filter((r) => r.itemId);
export const SIGN_NOTIFICATIONS = [
  { id: 'n-sign1', type: 'signature', actorId: 'u5', text: 'requested your signature on "Vendor Services Agreement.pdf"', link: '/signatures', at: ago(0, 6), read: false },
  { id: 'n-sign2', type: 'signature', actorId: 'u8', text: 'viewed "Offer Letter - Grace Liu.pdf" for signing', link: '/signatures?tab=sent', at: ago(0, 3), read: false },
];

// ---------- Admin & security seeds: legal holds, sign-in sessions ----------
export const LEGAL_HOLDS = [
  {
    id: 'lh-lakeside', name: 'Lakeside Co. contract review', note: 'Preserve all agreements and invoices exchanged with Lakeside Co. until legal closes the review.',
    itemIds: [idByName('Signed NDA.pdf'), fInv].filter(Boolean), spaces: [], createdBy: ME, createdAt: ago(10), active: true, releasedAt: null,
  },
];

const sess = (id, userId, device, location, ip, startedDays, activeHrs) => ({ id, userId, device, location, ip, startedAt: ago(startedDays), lastActive: ago(0, activeHrs), endedAt: null, endedBy: null });
export const SESSIONS = [
  sess('ss-me-phone', ME, 'Safari on iOS', 'Manila, PH', '203.0.113.42', 6, 5),
  sess('ss-me-mac', ME, 'Firefox on macOS', 'Singapore, SG', '198.51.100.23', 12, 72),
  sess('ss-priya', 'u2', 'Chrome on Windows', 'Manila, PH', '203.0.113.77', 2, 1),
  sess('ss-daniel', 'u3', 'Safari on macOS', 'Quezon City, PH', '203.0.113.18', 1, 0.3),
  sess('ss-daniel-ph', 'u3', 'Chrome on Android', 'Quezon City, PH', '203.0.113.19', 9, 30),
  sess('ss-marcus', 'u5', 'Edge on Windows', 'Cebu, PH', '198.51.100.61', 3, 48),
  sess('ss-omar', 'u7', 'Chrome on Linux', 'Dubai, AE', '192.0.2.140', 1, 6),
];

// ---------- External collaborators (guests) and their time-limited access ----------
const guestEod = (t) => new Date(t).setHours(23, 59, 59, 0);
export const GUEST_USERS = [
  { id: 'ug1', name: 'Rosa Delgado', email: 'rosa.delgado@lakeside.example', role: 'Guest', title: 'Legal Counsel', dept: 'Lakeside Co.', status: 'active', color: '#0E7490', joined: ago(40), invitedBy: ME, lastActive: ago(1, 3) },
  { id: 'ug2', name: 'Tom Becker', email: 'tom.becker@lakeside.example', role: 'Guest', title: 'Procurement Lead', dept: 'Lakeside Co.', status: 'active', color: '#7C3AED', joined: ago(36), invitedBy: ME, lastActive: ago(6) },
  { id: 'ug3', name: 'Ken Watanabe', email: 'ken@brightpixel.example', role: 'Guest', title: 'Design Contractor', dept: 'BrightPixel Studio', status: 'active', color: '#EA7A1A', joined: ago(20), invitedBy: 'u4', lastActive: ago(0, 5) },
  { id: 'ug4', name: 'Amara Okafor', email: 'amara.okafor@medisupply.example', role: 'Guest', title: 'Account Manager', dept: 'MediSupply', status: 'invited', color: '#DB2777', joined: ago(9), invitedBy: 'u2' },
];
// [item name, guest, role, shared days ago, expires in days (negative = already expired, null = never), shared by]
export const GUEST_SHARES = [
  ['Signed NDA.pdf', 'ug1', 'viewer', 30, 5, ME],
  ['Contract Template.doc', 'ug1', 'commenter', 12, 40, ME],
  ['Signed NDA.pdf', 'ug2', 'viewer', 33, -2, ME],
  ['Company Overview.pptx', 'ug2', 'viewer', 10, 12, ME],
  ['Website Redesign', 'ug3', 'editor', 8, 21, 'u4'],
  ['Wireframes v3.png', 'ug3', 'commenter', 4, null, ME],
  ['Annual Budget 2026.xlsx', 'ug4', 'viewer', 9, -3, ME],
];
export const GUEST_MEMBERS = [['t-hospital', 'ug4', 'Viewer', 9, 60, 'u2']];
export const guestShareEntry = ([, userId, role, sharedDays, expiresIn, by]) => ({
  userId, role, sharedAt: ago(sharedDays), sharedBy: by, expires: expiresIn == null ? null : guestEod(NOW + expiresIn * D),
});
export const guestMemberEntry = ([, userId, role, addedDays, expiresIn, by]) => ({
  userId, role, addedAt: ago(addedDays), addedBy: by, expires: expiresIn == null ? null : guestEod(NOW + expiresIn * D),
});
USERS.push(...GUEST_USERS);
for (const g of GUEST_SHARES) {
  const it = items.find((i) => i.name === g[0] && i.space === 'my');
  if (it) it.sharedWith = [...it.sharedWith, guestShareEntry(g)];
}
for (const g of GUEST_MEMBERS) TEAMS.find((t) => t.id === g[0])?.members.push(guestMemberEntry(g));

export const ITEMS = items;

export const NOTIFICATIONS = [
  { id: 'n1', type: 'share', actorId: 'u2', text: 'shared "Partner Pitch.pptx" with you', link: `/shared-with-me?highlight=${partnerPitch}&preview=${partnerPitch}`, at: ago(0, 1), read: false },
  { id: 'n2', type: 'comment', actorId: 'u3', text: 'commented on "Q3 Business Review.pdf": "Can we add the regional split?"', link: `/folders/${reports}?highlight=${q3Review}&preview=${q3Review}`, at: ago(0, 4), read: false },
  { id: 'n3', type: 'team', actorId: 'u4', text: 'added you to the team folder "Design Studio"', link: '/team-folders/t4', at: ago(1, 2), read: false },
  { id: 'n4', type: 'upload', actorId: 'u7', text: 'uploaded "Build Artifacts.zip" to Product & Engineering', link: `/team-folders/t2?highlight=${buildArtifacts}`, at: ago(2), read: true },
  { id: 'n5', type: 'system', actorId: null, text: 'Your storage is filling up. Consider cleaning up large files.', link: '/settings/storage', at: ago(3), read: true },
  { id: 'n6', type: 'share', actorId: 'u8', text: 'shared the folder "Hiring Plan 2026" with you', link: `/folders/${s1}`, at: ago(3, 3), read: true },
];
export const PRODUCTIVITY_NOTIFICATIONS = [
  { id: 'n7', type: 'approval', actorId: 'u2', text: 'asked you to approve "Holiday Campaign Brief.docx"', link: '/approvals', at: ago(0, 6), read: false },
  { id: 'n8', type: 'task', actorId: 'u3', text: 'assigned you a task: "Add the regional split to page 4"', link: '/tasks', at: ago(0, 8), read: false },
];
NOTIFICATIONS.push(...PRODUCTIVITY_NOTIFICATIONS, ...SIGN_NOTIFICATIONS);
NOTIFICATIONS.sort((a, b) => b.at - a.at);

const AUDIT_ACTIONS = [
  ['u2', 'File uploaded', 'Ad Creative A.png', 'Marketing'],
  ['u3', 'Permission changed', 'Search Revamp PRD.docx', 'Omar Haddad → Editor'],
  ['u1', 'User invited', 'Grace Liu', 'Role: Member'],
  ['u5', 'File downloaded', 'FY26 Forecast.xlsx', 'Finance & Operations'],
  ['u7', 'File uploaded', 'Build Artifacts.zip', 'Product & Engineering'],
  ['u1', 'Link created', 'Company Overview.pptx', 'Anyone with link, password protected'],
  ['u4', 'Team folder created', 'Design Studio', '3 members'],
  ['u6', 'File renamed', 'Content Calendar.xlsx', 'from "Calendar draft.xlsx"'],
  ['u1', 'Sign in', 'Web browser', 'Chrome on Windows'],
  ['u3', 'File deleted', 'Old Spec.docx', 'Moved to trash'],
  ['u2', 'Member added', 'Marketing', 'Sofia Alvarez as Viewer'],
  ['u5', 'File shared', 'Expense Report Oct.xlsx', 'Naresh Kumar Bishnoi (Viewer)'],
];
export const AUDIT = AUDIT_ACTIONS.map(([actorId, action, target, details], i) => ({
  id: `a${i}`, actorId, action, target, details, at: ago(Math.floor(i / 2), i * 3), ip: `10.0.${i + 2}.${40 + i * 7}`,
}));

// Look of public pages (shared links, file requests, embeds). Logo null = product logo.
export const BRANDING = {
  enabled: true, logo: null, displayName: '', headerColor: '#FFFFFF', accentColor: '#1686D9', background: 'tint',
  welcomeLink: 'Hi! {sender} from {org} shared this with you. If you have any questions, just reply to their email.',
  welcomeRequest: 'Thanks for helping us out. Files you upload go straight to {sender} at {org} and stay private.',
  footerText: 'Getmeds · Trusted healthcare supply partner', supportEmail: 'support@getmeds.ph', poweredBy: true,
};

export const ORG = {
  name: 'Getmeds',
  domain: 'getmeds.ph',
  quota: 1024 ** 4, // 1 TB org pool
  userQuota: 1024 ** 3, // 1 GB per user (kept small so the meter is meaningful)
  policies: {
    externalSharing: true,
    publicLinks: true,
    linkPasswordRequired: false,
    linkExpiryDays: 30,
    downloadRestriction: false,
    allowedDomains: 'getmeds.ph',
    twoFactor: false,
    sessionTimeout: 60,
    trashRetentionDays: 60,
    maxVersions: 25, // older file versions beyond this are discarded
    ocr: true, // read text in images and scanned PDFs so it's searchable
    smartLabels: 'suggest', // 'off' | 'suggest' | 'auto' — rule-based label & field suggestions from file text
    // Data loss prevention. action: 'monitor' (report only) | 'warn' | 'block'; detectors: { id: false } turns one off.
    dlp: { enabled: true, action: 'warn', minSeverity: 'medium', publicLinks: true, external: true, detectors: {} },
    watermarkPublicLinks: false, // force a watermark on every "anyone with the link" share
    fileRequests: true, // members may create upload-only file request links
    guestAccessDays: 30, // new access for people outside the organization expires after this many days (0 = never)
  },
  labels: LABELS,
  dataTemplates: DATA_TEMPLATES,
  branding: BRANDING,
};

export const TEMPLATES = [
  { id: 'tp1', name: 'Project Proposal', ext: 'docx', category: 'Documents', description: 'Scope, timeline, budget and sign-off sections.', content: 'Project Proposal\n\n1. Overview\n\n2. Objectives\n\n3. Scope\n\n4. Timeline\n\n5. Budget\n\n6. Approval' },
  { id: 'tp2', name: 'Meeting Minutes', ext: 'docx', category: 'Documents', description: 'Attendees, agenda, decisions and action items.', content: 'Meeting Minutes\n\nDate:\nAttendees:\n\nAgenda\n- \n\nDecisions\n- \n\nAction Items\n- ' },
  { id: 'tp3', name: 'Weekly Status Report', ext: 'docx', category: 'Documents', description: 'Progress, risks and next steps for your team.', content: 'Weekly Status Report\n\nHighlights\n\nRisks & Blockers\n\nNext Week' },
  { id: 'tp4', name: 'Budget Tracker', ext: 'xlsx', category: 'Spreadsheets', description: 'Monthly income, expense categories and variance.', sheet: [['Category', 'Budget', 'Actual', 'Variance'], ['Salaries', '42000', '41500', '500'], ['Software', '3200', '3560', '-360'], ['Travel', '2500', '1980', '520']] },
  { id: 'tp5', name: 'Project Timeline', ext: 'xlsx', category: 'Spreadsheets', description: 'Tasks, owners, start and due dates.', sheet: [['Task', 'Owner', 'Start', 'Due', 'Status'], ['Kickoff', 'Naresh', 'Nov 3', 'Nov 3', 'Done'], ['Design', 'Sofia', 'Nov 4', 'Nov 14', 'In progress']] },
  { id: 'tp6', name: 'Invoice', ext: 'xlsx', category: 'Spreadsheets', description: 'Itemized invoice with tax and totals.', sheet: [['Item', 'Qty', 'Rate', 'Amount'], ['Consulting', '10', '150', '1500']] },
  { id: 'tp7', name: 'Pitch Deck', ext: 'pptx', category: 'Presentations', description: 'Problem, solution, market and team slides.', slides: [{ title: 'Company Name', body: 'One-line pitch' }, { title: 'The Problem', body: 'What pain are we solving?' }, { title: 'Our Solution', body: 'How we solve it' }] },
  { id: 'tp8', name: 'Quarterly Review', ext: 'pptx', category: 'Presentations', description: 'KPIs, highlights and goals for next quarter.', slides: [{ title: 'Quarterly Review', body: 'Q4 2026' }, { title: 'Highlights', body: '• Revenue up 14%\n• Retention 93%' }] },
];
