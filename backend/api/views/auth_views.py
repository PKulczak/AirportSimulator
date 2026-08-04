from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from api.serializers.login_dto import LoginDto
from api.serializers.password_reset_confirm_dto import PasswordResetConfirmDto
from api.serializers.password_reset_request_dto import PasswordResetRequestDto
from api.serializers.register_dto import RegisterDto
from api.serializers.user_dto import UserDto


class LoginView(APIView):
    """POST /api/auth/login/ — always open (`AllowAny`) regardless of
    `REQUIRE_AUTH`: a login endpoint that itself required login would be a
    chicken-and-egg problem. Issues (or reuses) a DRF auth token for the
    authenticated user.

    Throttled (see REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["login"]) since
    this is the one endpoint that calls Django's `authenticate()` with
    caller-supplied credentials on every request with no other lockout —
    without a rate limit it's an open password-brute-force oracle once a
    deployment turns REQUIRE_AUTH on."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginDto(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserDto(user).data})


class LogoutView(APIView):
    """POST /api/auth/logout/ — deletes the caller's token so it can't
    authenticate anything else afterwards. Always requires a real
    authenticated user (not gated by REQUIRE_AUTH, unlike most of the API) —
    there's nothing meaningful to log out of otherwise."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        # filter().delete() rather than request.user.auth_token.delete(): a
        # session-authenticated user (see DEFAULT_AUTHENTICATION_CLASSES) who
        # has never logged in via LoginView has no Token row at all, and the
        # reverse-relation accessor raises an unhandled
        # Token.DoesNotExist/RelatedObjectDoesNotExist (a raw 500) in that
        # case. A missing row is simply a no-op logout either way.
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    """GET /api/auth/me/ — lets the frontend confirm "am I logged in, and as
    whom" (e.g. after a page refresh, from a token alone) rather than
    trusting local storage until the first real request 401s. Always
    requires a real authenticated user, same reasoning as LogoutView."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserDto(request.user).data)


class RegisterView(APIView):
    """POST /api/auth/register/ — self-serve account creation (Slice B.2),
    the only way to get an account besides `manage.py createsuperuser`/the
    Django admin. Always open (`AllowAny`) for the same reason as LoginView.

    Throttled (`register` scope): an anonymous caller can otherwise run
    Django's password validators and hit the DB on every request with no
    other lockout — the same brute-force/spam concern LoginView's `login`
    scope guards against, just for account creation instead of credential
    guessing. Auto-issues a token on success, mirroring LoginView's response
    shape, so a fresh signup logs straight in rather than bouncing to a
    separate login step.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterDto(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserDto(user).data},
            status=status.HTTP_201_CREATED,
        )


class PasswordResetRequestView(APIView):
    """POST /api/auth/password-reset/ — Slice B.2. Always responds
    204 regardless of whether `email` matches an account (and only ever
    sends mail when it does) — the same anti-enumeration principle as
    LoginDto, applied to "does this email have an account" instead of "is
    this the right password." Throttled (`password_reset` scope) so this
    can't be used to mail-bomb an arbitrary address."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestDto(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # filter() rather than get(): the stock User model doesn't enforce
        # email uniqueness, so in principle more than one active account
        # could share an address — every matching account gets its own
        # link/token rather than silently picking one.
        for user in User.objects.filter(email__iexact=email, is_active=True):
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password/{uid}/{token}/"
            send_mail(
                subject="Reset your Airport Modelling password",
                message=(
                    "Someone requested a password reset for this account.\n\n"
                    f"Reset it here: {reset_url}\n\n"
                    "If you didn't request this, you can safely ignore this email — "
                    "your password hasn't been changed."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
            )

        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset/confirm/ — Slice B.2. Validates the
    uid/token pair from the emailed link (see PasswordResetConfirmDto),
    then sets the new password and rotates the DRF token: a leaked/
    compromised token shouldn't stay valid across a reset the account owner
    just performed. Returns a fresh token/user, mirroring LoginView, so the
    reset itself logs the caller straight back in."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmDto(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])

        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)

        return Response({"token": token.key, "user": UserDto(user).data})
