import { Dialog } from 'primereact/dialog';
import RequestForm from './RequestForm';
import type { Simulation } from '../types/simulation';
import type { SimulationFormValues } from '../schemas/simulationForm';

interface SimulationFormDialogProps {
  visible: boolean;
  onHide: () => void;
  onCreated: (simulation: Simulation) => void;
  /** Pre-fill values (Duplicate or "from template" flow); omit for a blank
   * create form. */
  initialValues?: SimulationFormValues;
  /** Overrides the header text that's otherwise inferred purely from whether
   * `initialValues` is set ("Duplicate Simulation" vs "Create Simulation") —
   * needed once a third entry point (the template picker) also sets
   * `initialValues`, for a different reason than Duplicate. */
  title?: string;
}

export default function SimulationFormDialog({
  visible,
  onHide,
  onCreated,
  initialValues,
  title,
}: SimulationFormDialogProps) {
  return (
    <Dialog
      header={title ?? (initialValues ? 'Duplicate Simulation' : 'Create Simulation')}
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
