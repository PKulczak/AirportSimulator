from django.db import models

from api.managers.simulation_manager import SimulationManager
from api.managers.querysets.simulation_queryset import SimulationQuerySet


class Simulation(models.Model):
    class Status(models.TextChoices):
        PENDING = "Pending", "Pending"
        RUNNING = "Running", "Running"
        COMPLETE = "Complete", "Complete"
        ERROR = "Error", "Error"

    name = models.CharField(max_length=255)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )

    arrival_rate_per_hour = models.PositiveIntegerField()
    departure_rate_per_hour = models.PositiveIntegerField()
    duration_minutes = models.PositiveIntegerField()
    max_wait_minutes = models.PositiveIntegerField()
    aircraft_speed_knots = models.PositiveIntegerField()
    include_closures = models.BooleanField(default=False)
    random_seed = models.IntegerField(null=True, blank=True)

    error_message = models.TextField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = SimulationManager.from_queryset(SimulationQuerySet)()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.status})"
