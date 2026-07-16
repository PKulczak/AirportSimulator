from rest_framework import serializers

from api.models import SimulationRunway


class SimulationRunwayCreationDto(serializers.Serializer):
    runway_id = serializers.IntegerField()
    operating_mode = serializers.ChoiceField(
        choices=SimulationRunway.OperatingMode.choices
    )
