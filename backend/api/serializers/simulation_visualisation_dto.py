from rest_framework import serializers

from api.models import Simulation, SimulationRunway
from api.serializers.aircraft_visualisation_dto import AircraftVisualisationDto
from api.serializers.runway_event_visualisation_dto import (
    RunwayEventVisualisationDto,
)


class SimulationRunwayVisualisationDto(serializers.ModelSerializer):
    identifier = serializers.CharField(source="runway.identifier", read_only=True)
    closure_events = RunwayEventVisualisationDto(many=True, read_only=True)

    class Meta:
        model = SimulationRunway
        fields = [
            "id",
            "runway_id",
            "identifier",
            "operating_mode",
            "operational_status",
            "closure_events",
        ]


class SimulationVisualisationDto(serializers.ModelSerializer):
    aircraft = AircraftVisualisationDto(many=True, read_only=True)
    runways = SimulationRunwayVisualisationDto(
        source="simulation_runways", many=True, read_only=True
    )

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "status",
            "started_at",
            "duration_minutes",
            "max_wait_minutes",
            "aircraft_speed_knots",
            "aircraft",
            "runways",
        ]
