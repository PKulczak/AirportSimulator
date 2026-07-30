from django.db import models


class Aircraft(models.Model):
    class MovementType(models.TextChoices):
        ARRIVAL = "Arrival", "Arrival"
        DEPARTURE = "Departure", "Departure"

    class WeightClass(models.TextChoices):
        HEAVY = "Heavy", "Heavy"
        MEDIUM = "Medium", "Medium"
        LIGHT = "Light", "Light"

    class Outcome(models.TextChoices):
        PENDING = "Pending", "Pending"
        SUCCESS = "Success", "Success"
        DIVERTED = "Diverted", "Diverted"
        CANCELLED = "Cancelled", "Cancelled"

    simulation = models.ForeignKey(
        "api.Simulation", on_delete=models.CASCADE, related_name="aircraft"
    )
    runway = models.ForeignKey(
        "api.Runway",
        on_delete=models.SET_NULL,
        related_name="aircraft",
        null=True,
        blank=True,
    )

    callsign = models.CharField(max_length=32)
    operator = models.CharField(max_length=128)
    origin_destination = models.CharField(max_length=64)
    movement_type = models.CharField(max_length=16, choices=MovementType.choices)
    # Drives wake-turbulence separation minima (see
    # constants.WAKE_SEPARATION_EXTRA_MINUTES) — a Heavy/Medium leading this
    # aircraft's operation may force it to wait longer than the base
    # runway-occupancy time before it can actually go.
    weight_class = models.CharField(
        max_length=16, choices=WeightClass.choices, default=WeightClass.MEDIUM
    )

    initial_fuel_minutes = models.FloatField()

    scheduled_time = models.DateTimeField()
    queue_entry_time = models.DateTimeField(null=True, blank=True)
    runway_assigned_time = models.DateTimeField(null=True, blank=True)
    completion_time = models.DateTimeField(null=True, blank=True)

    wait_minutes = models.FloatField(null=True, blank=True)

    outcome = models.CharField(
        max_length=16, choices=Outcome.choices, default=Outcome.PENDING
    )
    was_success = models.BooleanField(null=True, blank=True)
    final_priority_score = models.FloatField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["simulation", "outcome"]),
        ]
        ordering = ["scheduled_time"]

    def __str__(self):
        return f"{self.callsign} ({self.outcome})"
