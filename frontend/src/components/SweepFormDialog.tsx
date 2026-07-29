import { Dialog } from 'primereact/dialog';
import SweepForm from './SweepForm';

interface SweepFormDialogProps {
  visible: boolean;
  onHide: () => void;
  /** Fired once the user dismisses the post-submit summary. */
  onDone: () => void;
}

export default function SweepFormDialog({ visible, onHide, onDone }: SweepFormDialogProps) {
  return (
    <Dialog
      header="Create Sweep"
      visible={visible}
      onHide={onHide}
      style={{ width: '54rem', maxWidth: '95vw' }}
      modal
    >
      <SweepForm
        onDone={() => {
          onDone();
          onHide();
        }}
      />
    </Dialog>
  );
}
