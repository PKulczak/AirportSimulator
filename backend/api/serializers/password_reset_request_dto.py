from rest_framework import serializers


class PasswordResetRequestDto(serializers.Serializer):
    """POST /api/auth/password-reset/ request body (Slice B.2). Deliberately
    just format validation — whether `email` actually matches an account is
    decided (and never revealed either way) by `PasswordResetRequestView`,
    the same anti-enumeration principle as `LoginDto`'s single generic error
    message for "no such user" vs. "wrong password"."""

    email = serializers.EmailField()
