import { Dialog } from 'primereact/dialog';
import RequestForm from './RequestForm';
import type { Simulation } from '../types/simulation';
import type { SimulationFormValues } from '../schemas/simulationForm';

interface SimulationFormDialogProps {
  visible: boolean;
  onHide: () => void;
  onCreated: (simulation: Simulation) => void;
  /** Pre-fill values (Duplicate flow); omit for a blank create form. */
  initialValues?: SimulationFormValues;
}

export default function SimulationFormDialog({
  visible,
  onHide,
  onCreated,
  initialValues,
}: SimulationFormDialogProps) {
  return (
    <Dialog
      header={initialValues ? 'Duplicate Simulation' : 'Create Simulation'}
      visible={visible}
      onHide={onHide}
      style={{ width: '54rem', maxWidth: '95vw' }}
      modal
    >
      <RequestForm
        initialValues={initialValues}
        onCreated={(simulation) => {
          onCreated(simulation);
          onHide();
        }}
      />
    </Dialog>
  );
}
