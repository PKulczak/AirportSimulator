from rest_framework import serializers

from api.models import Runway


class RunwayDto(serializers.ModelSerializer):
    class Meta:
        model = Runway
        fields = ["id", "identifier", "heading_degrees", "length_metres", "is_active"]
