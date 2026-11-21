import { Suspense } from 'react';
import { useUI, DialogLayerCtx } from '../../store/UIContext';
import { ConfirmDialog, CreateFolderDialog, RenameDialog, MoveCopyDialog, CreateDocDialog, TemplatePickerDialog } from './FileDialogs';
import { UploadDialog, UploadConflictDialog } from './UploadDialog';
import { lazyNamed } from '../../utils/lazy';
import ErrorBoundary from '../common/ErrorBoundary';

// Everyday dialogs above load with the app; the rest load the first time they're opened.
const ShareDialog = lazyNamed(() => import('./ShareDialog'));
const BulkRenameDialog = lazyNamed(() => import('./BulkRenameDialog'), 'BulkRenameDialog');
const TaskDialog = lazyNamed(() => import('./ProductivityDialogs'), 'TaskDialog');
const ApprovalDialog = lazyNamed(() => import('./ProductivityDialogs'), 'ApprovalDialog');
const ShortcutsDialog = lazyNamed(() => import('./ProductivityDialogs'), 'ShortcutsDialog');
const RestoreDialog = lazyNamed(() => import('../../restore/RestoreDialog'));
const OffboardDialog = lazyNamed(() => import('../../offboard/OffboardDialog'));
const TeamCreateDialog = lazyNamed(() => import('./TeamDialogs'), 'TeamCreateDialog');
const TeamMembersDialog = lazyNamed(() => import('./TeamDialogs'), 'TeamMembersDialog');
const TeamRenameDialog = lazyNamed(() => import('./TeamDialogs'), 'TeamRenameDialog');
const TeamActivityDialog = lazyNamed(() => import('./TeamDialogs'), 'TeamActivityDialog');
const HelpDialog = lazyNamed(() => import('./MiscDialogs'), 'HelpDialog');
const FileRequestDialog = lazyNamed(() => import('./FileRequestDialog'));
const CompareDialog = lazyNamed(() => import('../../viewing/CompareDialog'));
const SignRequestDialog = lazyNamed(() => import('../../signatures/SignRequestDialog'));
const SignDocumentDialog = lazyNamed(() => import('../../signatures/SignDocument'), 'SignDocumentDialog');
const LabelsDialog = lazyNamed(() => import('./OrganizeDialogs'), 'LabelsDialog');
const FolderColorDialog = lazyNamed(() => import('./OrganizeDialogs'), 'FolderColorDialog');
const MetadataDialog = lazyNamed(() => import('./OrganizeDialogs'), 'MetadataDialog');
const LabelEditDialog = lazyNamed(() => import('./OrganizeDialogs'), 'LabelEditDialog');
const DataTemplateDialog = lazyNamed(() => import('./OrganizeDialogs'), 'DataTemplateDialog');

const LinkToolsDialog = lazyNamed(() => import('../../sharing/LinkToolsDialog'));

const REGISTRY = {
  confirm: ConfirmDialog,
  createFolder: CreateFolderDialog,
  rename: RenameDialog,
  moveCopy: MoveCopyDialog,
  createDoc: CreateDocDialog,
  templatePicker: TemplatePickerDialog,
  share: ShareDialog,
  upload: UploadDialog,
  teamCreate: TeamCreateDialog,
  teamMembers: TeamMembersDialog,
  teamRename: TeamRenameDialog,
  teamActivity: TeamActivityDialog,
  help: HelpDialog,
  labels: LabelsDialog,
  folderColor: FolderColorDialog,
  metadata: MetadataDialog,
  labelEdit: LabelEditDialog,
  dataTemplate: DataTemplateDialog,
  fileRequest: FileRequestDialog,
  uploadConflicts: UploadConflictDialog,
  bulkRename: BulkRenameDialog,
  task: TaskDialog,
  approval: ApprovalDialog,
  shortcuts: ShortcutsDialog,
  restoreFolder: RestoreDialog,
  offboard: OffboardDialog,
  compareVersions: CompareDialog,
  signRequest: SignRequestDialog,
  signDocument: SignDocumentDialog,
  linkTools: LinkToolsDialog,
};

export default function DialogHost() {
  const { dialogs, closeDialog } = useUI();
  if (!dialogs.length) return null;
  return dialogs.map((d, i) => {
    const C = REGISTRY[d.type];
    if (!C) return null;
    const top = i === dialogs.length - 1;
    return (
      <DialogLayerCtx.Provider key={d.key} value={{ top, depth: i }}>
        {/* A dialog that crashes becomes a small "Something went wrong" modal; the page and other dialogs stay. */}
        <ErrorBoundary variant="dialog" onClose={() => closeDialog(d.key)}>
          <Suspense fallback={top ? <div className="modal-backdrop dialog-loading" role="status"><span className="spinner" aria-hidden="true" /><span className="sr-only">Loading…</span></div> : null}>
            <C {...d.props} onClose={() => closeDialog(d.key)} />
          </Suspense>
        </ErrorBoundary>
      </DialogLayerCtx.Provider>
    );
  });
}
