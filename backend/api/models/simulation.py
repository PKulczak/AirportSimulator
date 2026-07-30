from django.db import models

from api.managers.simulation_manager import SimulationManager
from api.managers.querysets.simulation_queryset import SimulationQuerySet


class Simulation(models.Model):
    class Status(models.TextChoices):
        PENDING = "Pending", "Pending"
        RUNNING = "Running", "Running"
        COMPLETE = "Complete", "Complete"
        ERROR = "Error", "Error"
        CANCELLED = "Cancelled", "Cancelled"

    # Statuses a run can no longer leave — nothing more will run for it.
    TERMINAL_STATUSES = (Status.COMPLETE, Status.ERROR, Status.CANCELLED)

    class WeatherCondition(models.TextChoices):
        CLEAR = "Clear", "Clear (VMC)"
        WINDY = "Windy", "Windy"
        SNOW = "Snow", "Snow"
        LOW_VISIBILITY = "LowVisibility", "Low Visibility (IMC)"

    name = models.CharField(max_length=255)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )
    # Set by the cancel endpoint; the runner polls it at safe points and stops.
    # Kept separate from `status` so the web process and the worker never race
    # to own the same column (the worker owns `status`).
    cancel_requested = models.BooleanField(default=False)

    arrival_rate_per_hour = models.PositiveIntegerField()
    departure_rate_per_hour = models.PositiveIntegerField()
    duration_minutes = models.PositiveIntegerField()
    max_wait_minutes = models.PositiveIntegerField()
    aircraft_speed_knots = models.PositiveIntegerField()
    include_closures = models.BooleanField(default=False)
    random_seed = models.IntegerField(null=True, blank=True)
    # Scales runway-operation time, wake-separation minima, and (when
    # include_closures is on) closure frequency/reason mix — see
    # constants.WEATHER_OPERATION_MULTIPLIER et al. Clear is the neutral
    # baseline (1.0x everywhere, matching engine behaviour before this field
    # existed).
    weather_condition = models.CharField(
        max_length=16, choices=WeatherCondition.choices, default=WeatherCondition.CLEAR
    )
    # Optional override of the engine's default Heavy/Medium/Light traffic mix
    # (see constants.DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES). All three null (the
    # default) means "use the engine's built-in mix"; the creation DTO
    # requires all three set together, summing to 100, whenever any is given.
    heavy_percentage = models.PositiveIntegerField(null=True, blank=True)
    medium_percentage = models.PositiveIntegerField(null=True, blank=True)
    light_percentage = models.PositiveIntegerField(null=True, blank=True)
    # Optional grouping for a set of runs (e.g. a parameter sweep). Nullable —
    # most runs aren't part of a batch. SET_NULL rather than CASCADE: deleting
    # the batch grouping shouldn't delete the underlying run results.
    batch = models.ForeignKey(
        "api.SimulationBatch",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="simulations",
    )

    error_message = models.TextField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Bumped on a real/wall-clock cadence while status is Running (see
    # SimulationRunner's watchdog) — kept separate from `updated_at` so a
    # future field write mid-run can't accidentally look like a fresh
    # heartbeat. `check_stalled_simulations` compares this against a timeout
    # to catch a dead/hung worker that would otherwise leave a run stuck
    # Running forever.
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = SimulationManager.from_queryset(SimulationQuerySet)()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.status})"
