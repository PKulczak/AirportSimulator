from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.serializers.login_dto import LoginDto
from api.serializers.user_dto import UserDto


class LoginView(APIView):
    """POST /api/auth/login/ — always open (`AllowAny`) regardless of
    `REQUIRE_AUTH`: a login endpoint that itself required login would be a
    chicken-and-egg problem. Issues (or reuses) a DRF auth token for the
    authenticated user."""

    permission_classes = [AllowAny]

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
        request.user.auth_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    """GET /api/auth/me/ — lets the frontend confirm "am I logged in, and as
    whom" (e.g. after a page refresh, from a token alone) rather than
    trusting local storage until the first real request 401s. Always
    requires a real authenticated user, same reasoning as LogoutView."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserDto(request.user).data)
