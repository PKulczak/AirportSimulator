from rest_framework import serializers

from api.models import SimulationRunway


class SimulationRunwayCreationDto(serializers.Serializer):
    runway_id = serializers.IntegerField()
    operating_mode = serializers.ChoiceField(
        choices=SimulationRunway.OperatingMode.choices
    )
    operational_status = serializers.ChoiceField(
        choices=SimulationRunway.OperationalStatus.choices,
        required=False,
        default=SimulationRunway.OperationalStatus.OPEN,
    )
