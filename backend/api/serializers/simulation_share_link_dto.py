from rest_framework import serializers

from api.models import SimulationShareLink


class SimulationShareLinkDto(serializers.ModelSerializer):
    class Meta:
        model = SimulationShareLink
        fields = ["token", "created_at"]
        read_only_fields = fields
