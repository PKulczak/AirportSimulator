from rest_framework import serializers

from api.models import Simulation


class SimulationListDto(serializers.ModelSerializer):
    runway_count = serializers.SerializerMethodField()

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
            "created_at",
            "completed_at",
            "runway_count",
        ]

    def get_runway_count(self, obj):
        # Annotated by SimulationQuerySet.with_runway_count() for the list
        # endpoint; falls back to a direct count for the create-response case,
        # where the serializer runs against a plain (unannotated) instance.
        annotated = getattr(obj, "runway_count", None)
        if annotated is not None:
            return annotated
        return obj.simulation_runways.count()
