from django.contrib.auth import authenticate
from rest_framework import serializers


class LoginDto(serializers.Serializer):
    """Validates a username/password pair against Django's configured auth
    backends; on success, `validated_data['user']` is the authenticated
    `User` for the view to issue a token for. Deliberately a single generic
    error message for both "no such user" and "wrong password" — not
    revealing which one it was is a basic guard against username
    enumeration."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        user = authenticate(username=attrs["username"], password=attrs["password"])
        if user is None:
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active:
            raise serializers.ValidationError("This account is inactive.")
        attrs["user"] = user
        return attrs
