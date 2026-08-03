from rest_framework import serializers

from api.models import SimulationBatchShareLink


class SimulationBatchShareLinkDto(serializers.ModelSerializer):
    class Meta:
        model = SimulationBatchShareLink
        fields = ["token", "created_at"]
        read_only_fields = fields
