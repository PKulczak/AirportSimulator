from rest_framework import serializers

from api.models import SimulationRunwayEvent


class RunwayEventVisualisationDto(serializers.ModelSerializer):
    class Meta:
        model = SimulationRunwayEvent
        fields = ["id", "event_type", "occurred_at", "reason"]
