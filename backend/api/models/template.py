from django.db import models

from api.managers.template_manager import TemplateManager
from api.models.simulation import Simulation


class Template(models.Model):
    """A saved, named simulation config a user can reuse to pre-fill the
    create form (Slice 8.1). Deliberately holds no simulation `name` — that's
    chosen fresh each time a template is applied; `name` here identifies the
    saved preset itself in the picker list, not any run created from it.
    Field set otherwise mirrors `Simulation`'s own creation-config fields
    (see `SimulationConfigDto`) so the two can share the same frontend
    form-values shape (`SimulationFormValues`)."""

    name = models.CharField(max_length=255)
    arrival_rate_per_hour = models.PositiveIntegerField()
    departure_rate_per_hour = models.PositiveIntegerField()
    duration_minutes = models.PositiveIntegerField()
    max_wait_minutes = models.PositiveIntegerField()
    aircraft_speed_knots = models.PositiveIntegerField()
    include_closures = models.BooleanField(default=False)
    random_seed = models.IntegerField(null=True, blank=True)
    weather_condition = models.CharField(
        max_length=16,
        choices=Simulation.WeatherCondition.choices,
        default=Simulation.WeatherCondition.CLEAR,
    )
    # Optional Heavy/Medium/Light traffic-mix override; all three null (the
    # default) means "use the engine's default mix" — same all-or-nothing,
    # sum-to-100 rule as Simulation's own fields, enforced by TemplateDto.
    heavy_percentage = models.PositiveIntegerField(null=True, blank=True)
    medium_percentage = models.PositiveIntegerField(null=True, blank=True)
    light_percentage = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    objects = TemplateManager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name
