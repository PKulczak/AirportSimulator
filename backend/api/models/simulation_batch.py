from django.db import models


class SimulationBatch(models.Model):
    """Groups a set of Simulation runs together (e.g. a parameter sweep)."""

    created_at = models.DateTimeField(auto_now_add=True)
    # Wire-level (camelCase) name of the field a sweep stepped, e.g.
    # "arrivalRatePerHour" — matches CreateSweepRequest.variable exactly so the
    # frontend can use it directly without a second mapping step. Null for a
    # batch that isn't a sweep — grouping is the general primitive; only
    # sweep-creation populates this.
    swept_variable = models.CharField(max_length=32, null=True, blank=True)

    def __str__(self):
        return f"Batch {self.id}"
