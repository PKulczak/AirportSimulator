from django.contrib.auth.models import User
from rest_framework import serializers


class UserDto(serializers.ModelSerializer):
    """Read-only shape for "who am I logged in as" — deliberately excludes
    anything password-related; Django's built-in `User` model is used as-is
    (no custom user model), since Slice 9.1 is just auth mechanics, not
    self-serve account management."""

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_staff"]
