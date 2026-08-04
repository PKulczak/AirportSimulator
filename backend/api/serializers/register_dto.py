from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers


class RegisterDto(serializers.Serializer):
    """Self-serve account creation (Slice B.2) — the only way to get an
    account besides `manage.py createsuperuser`/the Django admin (see
    `UserDto`'s old docstring). `email` is required (not just Django's
    default-optional `User.email`) since it's also how a password-reset link
    finds the account.

    Password strength runs through Django's own
    `AUTH_PASSWORD_VALIDATORS` — the same rules an admin-created account
    would nominally be expected to meet, just actually enforced here since
    this is the one path where a caller supplies the password directly.
    `UserAttributeSimilarityValidator` needs a user instance to compare
    against; the account doesn't exist yet at validation time, so an
    unsaved, in-memory `User` built from this same payload stands in for it.
    """

    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    password_confirm = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate_username(self, username):
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("That username is already taken.")
        return username

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})

        candidate = User(username=attrs["username"], email=attrs["email"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})

        return attrs

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data["email"],
            password=validated_data["password"],
        )
