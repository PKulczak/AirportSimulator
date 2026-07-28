from rest_framework import serializers

from api.models import Simulation
from api.serializers.simulation_creation_dto import NAME_PATTERN


class SimulationRenameDto(serializers.ModelSerializer):
    """Update DTO for renaming a run. Deliberately exposes only `name` (plus a
    read-only `id`), so a PATCH can't quietly change rates/runways/etc. — the
    rest of a run's config is immutable once created. Reuses the creation DTO's
    `NAME_PATTERN` so both entry points accept exactly the same names."""

    class Meta:
        model = Simulation
        fields = ["id", "name"]
        read_only_fields = ["id"]

    def validate_name(self, name):
        name = name.strip()
        if not name:
            raise serializers.ValidationError("Name is required.")
        if not NAME_PATTERN.match(name):
            raise serializers.ValidationError(
                "Name can only contain letters, numbers, spaces, and basic punctuation."
            )
        return name
