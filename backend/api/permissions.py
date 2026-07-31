from django.conf import settings
from rest_framework.permissions import IsAuthenticated


class IsAuthenticatedUnlessAuthDisabled(IsAuthenticated):
    """The API's global default permission (Slice 9.1). Requires a real
    authenticated user only when `settings.REQUIRE_AUTH` is on; every
    endpoint stays open (matching the app's pre-auth behaviour) while it's
    off — the default, until a deployment explicitly opts into enforcing
    login. See the REQUIRE_AUTH setting for why the default is False."""

    def has_permission(self, request, view):
        if not settings.REQUIRE_AUTH:
            return True
        return super().has_permission(request, view)
