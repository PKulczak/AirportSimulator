from django.db import models


class AircraftEvent(models.Model):
    class EventType(models.TextChoices):
        LOW_FUEL = "LowFuel", "Low Fuel"
        FUEL_CRITICAL = "FuelCritical", "Fuel Critical"
        MECHANICAL_FAILURE = "MechanicalFailure", "Mechanical Failure"
        PASSENGER_HEALTH = "PassengerHealth", "Passenger Health"

    aircraft = models.ForeignKey(
        "api.Aircraft", on_delete=models.CASCADE, related_name="events"
    )
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    occurred_at = models.DateTimeField()
    priority_boost = models.IntegerField(default=0)
    detail = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ["occurred_at"]

    def __str__(self):
        return f"{self.event_type} @ {self.occurred_at} for {self.aircraft_id}"
