from rest_framework import serializers

from api.models import CompareShareLink


class CompareShareLinkDto(serializers.ModelSerializer):
    class Meta:
        model = CompareShareLink
        fields = ["token", "created_at"]
        read_only_fields = fields
