import re

from django.conf import settings
from rest_framework import serializers

from api.models import Runway, Simulation, SimulationRunway
from api.serializers.simulation_runway_creation_dto import (
    SimulationRunwayCreationDto,
)

# Letters (Unicode-aware), numbers, underscore (all via \w), whitespace, and a
# small set of basic punctuation — mirrors the frontend's simulationForm.ts
# name regex, so a name accepted by one layer is accepted by the other.
NAME_PATTERN = re.compile(r"^[\w\s.,'()#:/&-]+$")


class SimulationCreationDto(serializers.ModelSerializer):
    runways = SimulationRunwayCreationDto(many=True)
    aircraft_speed_knots = serializers.IntegerField(required=False, min_value=1)
    arrival_rate_per_hour = serializers.IntegerField(
        min_value=0,
        max_value=100,
        error_messages={"max_value": "Must be 100 or fewer per hour."},
    )
    departure_rate_per_hour = serializers.IntegerField(
        min_value=0,
        max_value=100,
        error_messages={"max_value": "Must be 100 or fewer per hour."},
    )

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

    MAX_RUNWAYS = 10

    def validate_name(self, name):
        if not NAME_PATTERN.match(name):
            raise serializers.ValidationError(
                "Name can only contain letters, numbers, spaces, and basic punctuation."
            )
        return name

    def validate_runways(self, runways):
        if len(runways) == 0:
            raise serializers.ValidationError(
                "At least one runway must be selected."
            )
        if len(runways) > self.MAX_RUNWAYS:
            raise serializers.ValidationError(
                f"At most {self.MAX_RUNWAYS} runways may be selected."
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
        duration_minutes = attrs.get("duration_minutes", 0)
        max_wait_minutes = attrs.get("max_wait_minutes", 0)
        include_closures = attrs.get("include_closures", False)

        if arrival_rate <= 0 and departure_rate <= 0:
            raise serializers.ValidationError(
                "At least one of arrival or departure rate must be greater than zero."
            )

        # Integer-only comparison (maxWait * 10 <= duration * 9) instead of
        # `max_wait_minutes <= duration_minutes * 0.9` — avoids floating-point
        # rounding at the threshold, and mirrors the frontend's check exactly.
        if max_wait_minutes * 10 > duration_minutes * 9:
            raise serializers.ValidationError(
                "Max wait time must be at most 90% of the simulation duration."
            )

        if include_closures and len(runways) < 2:
            raise serializers.ValidationError(
                "At least 2 runways must be selected when random runway closures "
                "are enabled."
            )

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

        # Independent of the one-directional gate above: even a Mixed runway
        # covering a direction is no good if it's the only one and it starts
        # non-Available, so this must be checked regardless of whether other
        # runways are one-directional.
        available = SimulationRunway.OperationalStatus.AVAILABLE
        arrivals_modes = {
            SimulationRunway.OperatingMode.ARRIVALS_ONLY,
            SimulationRunway.OperatingMode.MIXED,
        }
        departures_modes = {
            SimulationRunway.OperatingMode.DEPARTURES_ONLY,
            SimulationRunway.OperatingMode.MIXED,
        }
        if arrival_rate > 0 and not any(
            runway["operating_mode"] in arrivals_modes
            and runway["operational_status"] == available
            for runway in runways
        ):
            raise serializers.ValidationError(
                "At least one runway accepting arrivals must start out Available."
            )
        if departure_rate > 0 and not any(
            runway["operating_mode"] in departures_modes
            and runway["operational_status"] == available
            for runway in runways
        ):
            raise serializers.ValidationError(
                "At least one runway accepting departures must start out Available."
            )

        return attrs

    def create(self, validated_data):
        runways = validated_data.pop("runways")
        validated_data.setdefault(
            "aircraft_speed_knots", settings.AIRCRAFT_SPEED_IN_KNOTS
        )
        return Simulation.objects.create(runways=runways, **validated_data)
