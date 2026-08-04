from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers


class PasswordResetConfirmDto(serializers.Serializer):
    """POST /api/auth/password-reset/confirm/ request body (Slice B.2). `uid`
    and `token` are exactly what `PasswordResetRequestView` embedded in the
    emailed link. One generic "invalid or expired" error covers a garbled
    uid, an unknown/inactive user, and a bad/already-used token alike — same
    reasoning as `LoginDto`, and it also happens to be true: Django's
    `default_token_generator` binds the token to the user's current password
    hash, so it stops validating the moment this same reset is used once.
    """

    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    password_confirm = serializers.CharField(write_only=True, style={"input_type": "password"})

    INVALID_LINK_ERROR = "This password reset link is invalid or has expired."

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})

        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            raise serializers.ValidationError(self.INVALID_LINK_ERROR)

        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError(self.INVALID_LINK_ERROR)

        try:
            validate_password(attrs["password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})

        attrs["user"] = user
        return attrs
