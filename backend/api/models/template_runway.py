from django.db import models

from api.models.simulation_runway import SimulationRunway


class TemplateRunway(models.Model):
    """A single runway's config within a saved Template — mirrors
    SimulationRunway's per-runway shape (operating mode + initial status),
    scoped to a Template instead of a live Simulation. Reuses
    SimulationRunway's own OperatingMode/OperationalStatus choices rather than
    redefining them, since they're the same enums either way."""

    # related_name is deliberately "runways" (not "template_runways") so
    # `TemplateDto`'s `runways` field can read/write it with no `source=`
    # override — matching the field name to the model attribute name lets a
    # single field definition serve as both the input (validated_data key)
    # and output (instance attribute) side of the same DTO.
    template = models.ForeignKey(
        "api.Template", on_delete=models.CASCADE, related_name="runways"
    )
    runway = models.ForeignKey(
        "api.Runway", on_delete=models.PROTECT, related_name="template_runways"
    )
    operating_mode = models.CharField(
        max_length=16, choices=SimulationRunway.OperatingMode.choices
    )
    operational_status = models.CharField(
        max_length=16,
        choices=SimulationRunway.OperationalStatus.choices,
        default=SimulationRunway.OperationalStatus.AVAILABLE,
    )

    class Meta:
        unique_together = (("template", "runway"),)

    def __str__(self):
        return f"{self.runway.identifier} ({self.operating_mode}) for template {self.template_id}"
