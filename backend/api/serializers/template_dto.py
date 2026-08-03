from django.conf import settings
from rest_framework import serializers

from api.models import Runway, SimulationRunway, Template
from api.serializers.simulation_creation_dto import NAME_PATTERN
from api.serializers.simulation_runway_creation_dto import SimulationRunwayCreationDto


class TemplateDto(serializers.ModelSerializer):
    """Save/list/retrieve DTO for a saved config template (Slice 8.1). A
    single DTO serves every action — unlike Simulation, a Template has no
    async run lifecycle needing a separate create/list/detail split.

    `runways` reuses `SimulationRunwayCreationDto` for both directions: as
    input it validates each row the same way `SimulationCreationDto` does; as
    output it renders the same shape straight back — a Template's runway
    config never diverges from what was saved (unlike a live Simulation,
    whose `operational_status` random closures can mutate over a run).

    Cross-field validation deliberately mirrors `SimulationCreationDto`'s
    `validate()` almost exactly: a Template snapshots a complete,
    fully-specified config at save time (rates, runways, modes, closures
    toggle all fixed then and there), so every rule that would apply to
    actually creating a Simulation from this same config applies equally well
    right now — there's no "applies only later" subset to skip.
    """

    runways = SimulationRunwayCreationDto(many=True)
    aircraft_speed_knots = serializers.IntegerField(required=False, min_value=1)
    # Capped to mirror SimulationCreationDto/the frontend's zod schema (24h
    # max) — a template with an unbounded duration would happily save, then
    # blow up the worker the moment it's applied to create a run.
    duration_minutes = serializers.IntegerField(min_value=1, max_value=1440)
    max_wait_minutes = serializers.IntegerField(min_value=1, max_value=1440)
    random_seed = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=2147483647,
    )
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
    heavy_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    medium_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    light_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )

    class Meta:
        model = Template
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
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    MAX_RUNWAYS = 10

    def validate_name(self, name):
        name = name.strip()
        if not name:
            raise serializers.ValidationError("Name is required.")
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

        weight_class_percentages = {
            key: attrs.get(key)
            for key in ("heavy_percentage", "medium_percentage", "light_percentage")
        }
        provided = [value for value in weight_class_percentages.values() if value is not None]
        if provided:
            if len(provided) != 3:
                raise serializers.ValidationError(
                    "heavyPercentage, mediumPercentage, and lightPercentage must all be "
                    "provided together, or all omitted to use the default mix."
                )
            if sum(provided) != 100:
                raise serializers.ValidationError(
                    "heavyPercentage, mediumPercentage, and lightPercentage must sum to 100."
                )

        # Integer-only comparison, same reasoning as SimulationCreationDto:
        # avoids floating-point rounding at the threshold.
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
            and runway.get("operational_status", available) == available
            for runway in runways
        ):
            raise serializers.ValidationError(
                "At least one runway accepting arrivals must start out Available."
            )
        if departure_rate > 0 and not any(
            runway["operating_mode"] in departures_modes
            and runway.get("operational_status", available) == available
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
        return Template.objects.create(runways=runways, **validated_data)
