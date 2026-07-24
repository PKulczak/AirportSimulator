import { Dialog } from 'primereact/dialog';
import RequestForm from './RequestForm';
import type { Simulation } from '../types/simulation';

interface SimulationFormDialogProps {
  visible: boolean;
  onHide: () => void;
  onCreated: (simulation: Simulation) => void;
}

export default function SimulationFormDialog({
  visible,
  onHide,
  onCreated,
}: SimulationFormDialogProps) {
  return (
    <Dialog
      header="Create Simulation"
      visible={visible}
      onHide={onHide}
      style={{ width: '54rem', maxWidth: '95vw' }}
      modal
    >
      <RequestForm
        onCreated={(simulation) => {
          onCreated(simulation);
          onHide();
        }}
      />
    </Dialog>
  );
}
