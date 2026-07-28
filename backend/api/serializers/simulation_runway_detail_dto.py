from rest_framework import serializers


class SimulationRunwayDetailDto(serializers.Serializer):
    """Per-runway stats for the detail endpoint, computed in Python off the
    prefetched `aircraft`/`closure_events` relations rather than a second
    fragile fan-out annotation on the queryset."""

    runway_id = serializers.IntegerField()
    identifier = serializers.CharField()
    operating_mode = serializers.CharField()
    # End-of-run status (mutated by random closures during the run).
    operational_status = serializers.CharField()
    # Status as configured at creation — use this (not operational_status) to
    # reproduce/clone the run's starting conditions.
    initial_operational_status = serializers.CharField()
    total_assigned = serializers.IntegerField()
    success_count = serializers.IntegerField()
    closure_count = serializers.IntegerField()
    # Minutes the runway was open (not closed) within the simulation's
    # configured [0, duration] window; the frontend shows this over the
    # duration as an "open time" percentage.
    open_minutes = serializers.FloatField()
