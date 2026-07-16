from rest_framework import serializers

from api.models import Simulation


class SimulationListDto(serializers.ModelSerializer):
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
        ]
