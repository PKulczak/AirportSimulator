from django.db import transaction
from rest_framework import serializers

from api.models import SimulationBatch
from api.serializers.simulation_creation_dto import NAME_PATTERN, SimulationCreationDto
from api.serializers.simulation_runway_creation_dto import SimulationRunwayCreationDto

# Wire-level (camelCase, matching CreateSimulationRequest) variable name -> the
# snake_case Simulation field it steps. A subset of SimulationCreationDto's
# numeric fields — runways/name/closures/seed stay fixed across a sweep, only
# one flat numeric input varies.
SWEEPABLE_VARIABLES = {
    "arrivalRatePerHour": "arrival_rate_per_hour",
    "departureRatePerHour": "departure_rate_per_hour",
    "durationMinutes": "duration_minutes",
    "maxWaitMinutes": "max_wait_minutes",
    "aircraftSpeedKnots": "aircraft_speed_knots",
}

MAX_SWEEP_RUNS = 50


class SimulationSweepCreationDto(serializers.Serializer):
    """Creates a SimulationBatch plus one Simulation per step of `variable`'s
    range: from its value in this payload (the "start") up to `range_end`, in
    increments of `range_step`.

    Each generated run is independently re-validated through
    SimulationCreationDto rather than validating the base config once and
    assuming every step is equally valid — a value that's fine at the start of
    a sweep (e.g. a low arrival rate) can violate a business rule further along
    (e.g. no runway left able to accept a much higher rate).
    """

    # 200, not the model's 255: leaves headroom for the " (variable: value)"
    # suffix appended to each generated run's name.
    name = serializers.CharField(max_length=200)
    arrival_rate_per_hour = serializers.IntegerField(min_value=0, max_value=100)
    departure_rate_per_hour = serializers.IntegerField(min_value=0, max_value=100)
    duration_minutes = serializers.IntegerField(min_value=1)
    max_wait_minutes = serializers.IntegerField(min_value=1)
    aircraft_speed_knots = serializers.IntegerField(required=False, min_value=1)
    include_closures = serializers.BooleanField(required=False, default=False)
    random_seed = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=2147483647,
    )
    # Passed straight through to each per-run SimulationCreationDto re-validation
    # below, which enforces the all-or-nothing-summing-to-100 rule.
    heavy_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    medium_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    light_percentage = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=100
    )
    runways = SimulationRunwayCreationDto(many=True)
    variable = serializers.ChoiceField(choices=list(SWEEPABLE_VARIABLES))
    range_end = serializers.IntegerField()
    range_step = serializers.IntegerField(min_value=1)

    def validate_name(self, name):
        if not NAME_PATTERN.match(name):
            raise serializers.ValidationError(
                "Name can only contain letters, numbers, spaces, and basic punctuation."
            )
        return name

    def validate(self, attrs):
        field_name = SWEEPABLE_VARIABLES[attrs["variable"]]
        start = attrs.get(field_name)
        if start is None:
            raise serializers.ValidationError(
                {
                    "variable": (
                        f"'{attrs['variable']}' must be set on the base config to sweep it."
                    )
                }
            )
        end = attrs["range_end"]
        step = attrs["range_step"]
        if end < start:
            raise serializers.ValidationError(
                {
                    "range_end": (
                        "Must be greater than or equal to the base value of the swept variable."
                    )
                }
            )

        values = list(range(start, end + 1, step))
        if len(values) < 2:
            raise serializers.ValidationError(
                "The range and step must produce at least 2 runs to form a sweep."
            )
        if len(values) > MAX_SWEEP_RUNS:
            raise serializers.ValidationError(
                f"A sweep can create at most {MAX_SWEEP_RUNS} runs "
                f"(this range/step would create {len(values)})."
            )

        base_attrs = {
            key: value
            for key, value in attrs.items()
            if key not in ("variable", "range_end", "range_step")
        }
        run_configs = []
        errors = {}
        for value in values:
            run_attrs = {
                **base_attrs,
                field_name: value,
                "name": f"{attrs['name']} ({attrs['variable']}: {value})",
            }
            run_serializer = SimulationCreationDto(data=run_attrs)
            if run_serializer.is_valid():
                run_configs.append(run_serializer.validated_data)
            else:
                errors[str(value)] = run_serializer.errors
        if errors:
            raise serializers.ValidationError({"runs": errors})

        attrs["_run_configs"] = run_configs
        return attrs

    def create(self, validated_data):
        run_configs = validated_data.pop("_run_configs")
        with transaction.atomic():
            batch = SimulationBatch.objects.create(
                swept_variable=validated_data["variable"]
            )
            simulations = [
                SimulationCreationDto().create({**config, "batch": batch})
                for config in run_configs
            ]
        return simulations
