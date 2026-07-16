from django.conf import settings
from rest_framework import serializers

from api.models import Runway, Simulation, SimulationRunway
from api.serializers.simulation_runway_creation_dto import (
    SimulationRunwayCreationDto,
)


class SimulationCreationDto(serializers.ModelSerializer):
    runways = SimulationRunwayCreationDto(many=True)
    aircraft_speed_knots = serializers.IntegerField(required=False, min_value=1)

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "status",
            "arrival_rate_per_hour",
            "departure_rate_per_hour",
            "duration_minutes",
            "max_wait_minutes",
            "aircraft_speed_knots",
            "include_closures",
            "random_seed",
            "runways",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def validate_runways(self, runways):
        if len(runways) == 0:
            raise serializers.ValidationError(
                "At least one runway must be selected."
            )
        runway_ids = [runway["runway_id"] for runway in runways]
        if len(runway_ids) != len(set(runway_ids)):
            raise serializers.ValidationError(
                "Duplicate runway ids are not allowed."
            )
        existing_ids = set(
            Runway.objects.filter(id__in=runway_ids, is_active=True).values_list(
                "id", flat=True
            )
        )
        missing = set(runway_ids) - existing_ids
        if missing:
            raise serializers.ValidationError(
                f"Unknown or inactive runway ids: {sorted(missing)}"
            )
        return runways

    def validate(self, attrs):
        runways = attrs.get("runways", [])
        arrival_rate = attrs.get("arrival_rate_per_hour", 0)
        departure_rate = attrs.get("departure_rate_per_hour", 0)

        modes = {runway["operating_mode"] for runway in runways}
        all_one_directional = bool(modes) and (
            SimulationRunway.OperatingMode.MIXED not in modes
        )
        if all_one_directional:
            has_arrivals_runway = any(
                runway["operating_mode"] == "ArrivalsOnly" for runway in runways
            )
            has_departures_runway = any(
                runway["operating_mode"] == "DeparturesOnly" for runway in runways
            )
            if arrival_rate > 0 and not has_arrivals_runway:
                raise serializers.ValidationError(
                    "Arrival rate is nonzero but no configured runway accepts arrivals."
                )
            if departure_rate > 0 and not has_departures_runway:
                raise serializers.ValidationError(
                    "Departure rate is nonzero but no configured runway accepts departures."
                )
        return attrs

    def create(self, validated_data):
        runways = validated_data.pop("runways")
        validated_data.setdefault(
            "aircraft_speed_knots", settings.AIRCRAFT_SPEED_IN_KNOTS
        )
        return Simulation.objects.create(runways=runways, **validated_data)
