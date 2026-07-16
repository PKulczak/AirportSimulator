from rest_framework import serializers

from api.models import Aircraft, AircraftEvent


class AircraftEventVisualisationDto(serializers.ModelSerializer):
    class Meta:
        model = AircraftEvent
        fields = ["id", "event_type", "occurred_at", "priority_boost", "detail"]


class AircraftVisualisationDto(serializers.ModelSerializer):
    events = AircraftEventVisualisationDto(many=True, read_only=True)
    runway_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Aircraft
        fields = [
            "id",
            "runway_id",
            "callsign",
            "operator",
            "origin_destination",
            "movement_type",
            "initial_fuel_minutes",
            "scheduled_time",
            "queue_entry_time",
            "runway_assigned_time",
            "completion_time",
            "wait_minutes",
            "outcome",
            "was_success",
            "final_priority_score",
            "events",
        ]
