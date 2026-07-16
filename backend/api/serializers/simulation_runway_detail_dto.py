from rest_framework import serializers


class SimulationRunwayDetailDto(serializers.Serializer):
    """Per-runway stats for the detail endpoint, computed in Python off the
    prefetched `aircraft`/`closure_events` relations rather than a second
    fragile fan-out annotation on the queryset."""

    runway_id = serializers.IntegerField()
    identifier = serializers.CharField()
    operating_mode = serializers.CharField()
    operational_status = serializers.CharField()
    total_assigned = serializers.IntegerField()
    success_count = serializers.IntegerField()
    closure_count = serializers.IntegerField()
