from django.db import models


class SimulationRunwayEvent(models.Model):
    class EventType(models.TextChoices):
        CLOSED = "Closed", "Closed"
        REOPENED = "Reopened", "Reopened"

    simulation_runway = models.ForeignKey(
        "api.SimulationRunway", on_delete=models.CASCADE, related_name="closure_events"
    )
    event_type = models.CharField(max_length=16, choices=EventType.choices)
    occurred_at = models.DateTimeField()
    reason = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        ordering = ["occurred_at"]

    def __str__(self):
        return f"{self.event_type} @ {self.occurred_at} for {self.simulation_runway_id}"
