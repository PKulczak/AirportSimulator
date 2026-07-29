from django.db import models


class SimulationBatch(models.Model):
    """Groups a set of Simulation runs together (e.g. a parameter sweep).

    Deliberately minimal for now — just an identity to hang a group of runs
    off. Sweep-specific metadata (the swept variable, its range) belongs to
    whichever slice actually creates sweeps.
    """

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Batch {self.id}"
