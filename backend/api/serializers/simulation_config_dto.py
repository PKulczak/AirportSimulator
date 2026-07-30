from rest_framework import serializers

from api.models import Simulation
from api.serializers.runway_initial_status import initial_operational_status


class SimulationConfigDto(serializers.ModelSerializer):
    """Read DTO exposing a run's full *creation* config, shaped to match the
    `SimulationCreationDto` input so the frontend can round-trip it straight
    back into a new run (the "Duplicate" action). `runways` carries each
    runway's initial (as-configured) operational status, not the possibly
    closure-mutated end-of-run status."""

    runways = serializers.SerializerMethodField()

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "arrival_rate_per_hour",
            "departure_rate_per_hour",
            "duration_minutes",
            "max_wait_minutes",
            "aircraft_speed_knots",
            "include_closures",
            "random_seed",
            "heavy_percentage",
            "medium_percentage",
            "light_percentage",
            "weather_condition",
            "runways",
        ]

    def get_runways(self, obj):
        return [
            {
                "runway_id": simulation_runway.runway_id,
                "operating_mode": simulation_runway.operating_mode,
                "operational_status": initial_operational_status(
                    simulation_runway, obj.started_at
                ),
            }
            for simulation_runway in obj.simulation_runways.all()
        ]
