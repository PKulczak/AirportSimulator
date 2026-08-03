import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';

interface ShareLinkDialogProps {
  header: string;
  /** What this particular link grants access to, shown above the input. */
  description: string;
  visible: boolean;
  onHide: () => void;
  shareLink: string | null;
  copied: boolean;
  onCopy: () => void;
  copyError: boolean;
}

/** Shared "here's your read-only link" dialog — the same copy-to-clipboard UX
 * behind sharing a single run (MetricBasePage), a sweep (SweepResults), and a
 * compare view (CompareRuns); only the header/description text differs. */
export default function ShareLinkDialog({
  header,
  description,
  visible,
  onHide,
  shareLink,
  copied,
  onCopy,
  copyError,
}: ShareLinkDialogProps) {
  return (
    <Dialog
      header={header}
      visible={visible}
      onHide={onHide}
      draggable={false}
      dismissableMask
      style={{ width: '32rem', maxWidth: '90vw' }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-600">{description}</p>
        <div className="flex gap-2">
          <InputText
            readOnly
            value={shareLink ?? ''}
            onFocus={(e) => e.target.select()}
            className="flex-1 bg-white"
          />
          <Button
            label={copied ? 'Copied!' : 'Copy'}
            icon={copied ? 'pi pi-check' : 'pi pi-copy'}
            onClick={onCopy}
            className="!border-brand-accent-active !bg-brand-accent-active !text-black"
          />
        </div>
        {copyError && (
          <Message
            severity="error"
            text="Couldn't copy automatically — select the link above and copy it manually."
          />
        )}
      </div>
    </Dialog>
  );
}
